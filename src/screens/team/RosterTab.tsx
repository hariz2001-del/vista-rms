import { AlertTriangle, Image as ImageIcon, Lock, LockOpen, Plus, Printer, Sparkles, Trash2, X } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Badge, EmptyState, Panel } from '../../components/primitives.tsx'
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
  type RosterWarning,
  type WeekDetail,
  type WeekStatus,
  type WeekSummary,
} from '../../data/roster-api.ts'
import { errorText, teamApi, useLoad, type WorkType } from '../../data/team-api.ts'
import { formatRinggit, parseRinggitToSen } from '../../domain/money.ts'
import { RosterShare } from './RosterShare.tsx'

const STAGES: Array<{ status: WeekStatus; label: string }> = [
  { status: 'DRAFT', label: 'Draft' },
  { status: 'APPLICATIONS_OPEN', label: 'Applications open' },
  { status: 'APPLICATIONS_CLOSED', label: 'Applications closed' },
  { status: 'GENERATED', label: 'Suggested' },
  { status: 'IN_REVIEW', label: 'In review' },
  { status: 'PUBLISHED', label: 'Published' },
]

const PHASE_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  APPLICATIONS_OPEN: 'Applications open',
  APPLICATIONS_CLOSED: 'Applications closed',
  GENERATED: 'Suggested roster',
  IN_REVIEW: 'In review',
  PUBLISHED: 'Published',
  ACTIVE: 'This week',
  COMPLETED: 'Completed',
}

const SOURCE_LABEL: Record<RosterAssignment['source'], string> = { AUTO: 'Suggested', MANUAL: 'Manual', REPLACEMENT: 'Cover' }

function NewWeek({ existing, onCreated }: { existing: WeekSummary[]; onCreated: (detail: WeekDetail) => void }) {
  const taken = new Set(existing.map((week) => week.weekStart))
  const options = Array.from({ length: 8 }, (_, index) => addDaysTo(mondayOf(todayInKl()), 7 * index)).filter((monday) => !taken.has(monday))
  const [weekStart, setWeekStart] = useState(options[1] ?? options[0] ?? '')
  const [fromTemplate, setFromTemplate] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      onCreated(await rosterApi.createWeek(weekStart, fromTemplate))
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
      <label className="flex items-center gap-2 text-xs font-bold text-muted">
        <input type="checkbox" checked={fromTemplate} onChange={(event) => setFromTemplate(event.target.checked)} />
        Start from the usual week (Timetable tab)
      </label>
      <button type="submit" disabled={!weekStart} className="vista-button-primary flex min-h-10 w-full items-center justify-center gap-1 disabled:opacity-50">
        <Plus aria-hidden="true" className="size-4" /> Create week
      </button>
      {error ? <p className="text-xs font-bold text-serious">{error}</p> : null}
    </form>
  )
}

function StageBar({ detail, busy, onAction }: { detail: WeekDetail; busy: boolean; onAction: (action: () => Promise<WeekDetail>) => void }) {
  const { week } = detail
  const current = STAGES.findIndex((stage) => stage.status === week.status)
  const id = week.id
  const buttons: Array<{ label: string; run: () => Promise<WeekDetail>; primary?: boolean; icon?: typeof Sparkles }> = []
  if (week.status === 'DRAFT') buttons.push({ label: 'Open applications', run: () => rosterApi.setStatus(id, 'APPLICATIONS_OPEN'), primary: true })
  if (week.status === 'APPLICATIONS_OPEN') buttons.push({ label: 'Close applications', run: () => rosterApi.setStatus(id, 'APPLICATIONS_CLOSED'), primary: true })
  if (week.status !== 'PUBLISHED') {
    buttons.push({ label: week.generatedAt ? 'Generate again' : 'Generate suggested roster', run: () => rosterApi.generate(id), primary: ['APPLICATIONS_CLOSED'].includes(week.status), icon: Sparkles })
  }
  if (week.status === 'GENERATED') buttons.push({ label: 'Mark reviewed', run: () => rosterApi.setStatus(id, 'IN_REVIEW') })
  if (week.status !== 'PUBLISHED') buttons.push({ label: 'Publish to staff', run: () => rosterApi.publish(id), primary: ['GENERATED', 'IN_REVIEW'].includes(week.status) })
  if (week.status === 'PUBLISHED') buttons.push({ label: 'Unpublish (back to review)', run: () => rosterApi.setStatus(id, 'IN_REVIEW') })
  if (['APPLICATIONS_CLOSED', 'GENERATED', 'IN_REVIEW'].includes(week.status)) {
    buttons.push({ label: 'Reopen applications', run: () => rosterApi.setStatus(id, 'APPLICATIONS_OPEN') })
  }

  return (
    <div className="space-y-3">
      <ol className="flex flex-wrap gap-1" aria-label="Roster stages">
        {STAGES.map((stage, index) => (
          <li
            key={stage.status}
            aria-current={index === current ? 'step' : undefined}
            className={`px-2 py-1 font-mono text-[0.65rem] font-bold uppercase tracking-[0.06em] ${
              index === current ? 'bg-rail text-white' : index < current ? 'bg-rail/10 text-rail' : 'bg-canvas text-muted'
            }`}
          >
            {stage.label}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        {buttons.map((button) => {
          const Icon = button.icon
          return (
            <button
              key={button.label}
              type="button"
              disabled={busy}
              onClick={() => onAction(button.run)}
              className={`${button.primary ? 'vista-button-primary' : 'vista-button-secondary'} flex min-h-11 items-center gap-2 disabled:opacity-50`}
            >
              {Icon ? <Icon aria-hidden="true" className="size-4" /> : null}
              {button.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const shifted = new Date(new Date(iso).getTime() + 8 * 3_600_000).toISOString()
  return shifted.slice(0, 16)
}

function WeekRules({ detail, onSaved }: { detail: WeekDetail; onSaved: (next: WeekDetail) => void }) {
  const { week } = detail
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({
    applicationsOpenAt: toLocalInput(week.applicationsOpenAt),
    applicationsCloseAt: toLocalInput(week.applicationsCloseAt),
    publishDeadline: toLocalInput(week.publishDeadline),
    applicationLimit: week.applicationLimit,
    assignmentTargetShifts: week.assignmentTargetShifts,
    assignmentMaxShifts: week.assignmentMaxShifts,
    maxHours: week.assignmentMaxMinutes / 60,
    withdrawalDeadlineHours: week.withdrawalDeadlineHours,
  })
  const [error, setError] = useState<string | null>(null)
  const asIso = (value: string) => (value ? `${value}:00+08:00` : null)

  async function save() {
    setError(null)
    try {
      onSaved(
        await rosterApi.updateWeek(week.id, {
          applicationsOpenAt: asIso(draft.applicationsOpenAt),
          applicationsCloseAt: asIso(draft.applicationsCloseAt),
          publishDeadline: asIso(draft.publishDeadline),
          applicationLimit: draft.applicationLimit,
          assignmentTargetShifts: draft.assignmentTargetShifts,
          assignmentMaxShifts: draft.assignmentMaxShifts,
          assignmentMaxMinutes: Math.round(draft.maxHours * 60),
          withdrawalDeadlineHours: draft.withdrawalDeadlineHours,
        }),
      )
      setOpen(false)
    } catch (caught) {
      setError(errorText(caught))
    }
  }

  const summary = [
    week.applicationsCloseAt ? `applications close ${dateTimeText(week.applicationsCloseAt)}` : 'no closing time set',
    `apply for up to ${week.applicationLimit}`,
    `usually ${week.assignmentTargetShifts}, at most ${week.assignmentMaxShifts} shifts / ${hoursText(week.assignmentMaxMinutes)}`,
    `pull out up to ${week.withdrawalDeadlineHours}h before`,
  ].join(' · ')

  const number = (key: keyof typeof draft, label: string, step = 1) => (
    <label className="block">
      <span className="vista-field-label">{label}</span>
      <input
        type="number"
        step={step}
        min={0}
        value={draft[key] as number}
        onChange={(event) => setDraft({ ...draft, [key]: Number(event.target.value) })}
        className="vista-control mt-1 w-24 px-2 tabular"
      />
    </label>
  )

  return (
    <div className="border border-line bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">{summary}</span>
        <button type="button" onClick={() => setOpen(!open)} className="ml-auto text-xs font-bold text-rail underline">
          {open ? 'Close' : 'Change this week’s rules'}
        </button>
      </div>
      {open ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <label className="block">
            <span className="vista-field-label">Applications open</span>
            <input type="datetime-local" value={draft.applicationsOpenAt} onChange={(event) => setDraft({ ...draft, applicationsOpenAt: event.target.value })} className="vista-control mt-1 w-full px-2" />
          </label>
          <label className="block">
            <span className="vista-field-label">Applications close</span>
            <input type="datetime-local" value={draft.applicationsCloseAt} onChange={(event) => setDraft({ ...draft, applicationsCloseAt: event.target.value })} className="vista-control mt-1 w-full px-2" />
          </label>
          <label className="block">
            <span className="vista-field-label">Publish by</span>
            <input type="datetime-local" value={draft.publishDeadline} onChange={(event) => setDraft({ ...draft, publishDeadline: event.target.value })} className="vista-control mt-1 w-full px-2" />
          </label>
          {number('applicationLimit', 'May apply for')}
          {number('assignmentTargetShifts', 'Usual shifts')}
          {number('assignmentMaxShifts', 'Most shifts')}
          {number('maxHours', 'Most hours', 0.5)}
          {number('withdrawalDeadlineHours', 'Pull out until (h before)')}
          <div className="flex items-end gap-2 sm:col-span-3 lg:col-span-4">
            <button type="button" onClick={save} className="vista-button-primary min-h-10">
              Save rules
            </button>
            {error ? <p className="text-xs font-bold text-serious">{error}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function AssignmentEditor({
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

  async function saveRate() {
    const sen = rate.trim() === '' ? null : parseRinggitToSen(rate)
    if (rate.trim() !== '' && sen === null) {
      setError('Enter an hourly rate like 12.00, or leave it blank.')
      return
    }
    await onChange({ rateOverrideSen: sen, rateOverrideReason: sen === null ? null : reason.trim() || null })
  }

  return (
    <div className="mt-2 space-y-2 border border-rail/40 bg-canvas p-3 text-xs">
      <div className="flex items-center">
        <span className="font-black">{assignment.staffName}</span>
        <button type="button" aria-label="Close" onClick={onClose} className="ml-auto grid size-8 place-items-center">
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
      {assignment.explanation ? <p className="text-muted">Why: {assignment.explanation}</p> : null}
      <label className="block">
        <span className="vista-field-label">Work type for this shift</span>
        <select
          value={assignment.workTypeId ?? ''}
          onChange={(event) => void onChange({ workTypeId: event.target.value || null })}
          className="vista-control mt-1 w-full px-2"
        >
          <option value="">Their usual / the shift’s</option>
          {workTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name} · {formatRinggit(type.rateSenPerHour)}/h
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-[6rem_1fr] gap-2">
        <label className="block">
          <span className="vista-field-label">One-off RM/h</span>
          <input value={rate} onChange={(event) => setRate(event.target.value)} inputMode="decimal" placeholder="—" className="vista-control mt-1 w-full px-2" />
        </label>
        <label className="block">
          <span className="vista-field-label">Reason</span>
          <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. event night" className="vista-control mt-1 w-full px-2" />
        </label>
      </div>
      <button type="button" onClick={() => void saveRate()} className="vista-button-secondary min-h-9">
        Save rate
      </button>
      {error ? <p className="font-bold text-serious">{error}</p> : null}
    </div>
  )
}

function SlotCard({
  slot,
  detail,
  workTypes,
  warnings,
  onDetail,
  onWarnings,
  onError,
}: {
  slot: RosterSlot
  detail: WeekDetail
  workTypes: WorkType[]
  warnings: RosterWarning[]
  onDetail: (next: WeekDetail) => void
  onWarnings: (warnings: RosterWarning[]) => void
  onError: (message: string) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState('')
  const active = slot.assignments.filter((assignment) => assignment.status === 'ACTIVE')
  const applicantIds = new Set(slot.applicants.map((applicant) => applicant.staffId))
  const name = (id: string) => detail.staff.find((staff) => staff.id === id)?.name ?? '—'
  const choices = detail.staff
    .filter((staff) => staff.status === 'ACTIVE' && !active.some((assignment) => assignment.staffId === staff.id))
    .toSorted((a, b) => Number(applicantIds.has(b.id)) - Number(applicantIds.has(a.id)) || a.name.localeCompare(b.name))

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
      if (result.warnings.length > 0) onWarnings(result.warnings)
    } catch (caught) {
      onError(errorText(caught))
    }
    setAdding('')
  }

  const filled = active.length >= slot.requiredStaff
  return (
    <article className={`border bg-surface p-3 ${slot.openCoverage?.isUrgent ? 'border-critical' : filled ? 'border-line' : 'border-warning/60'}`}>
      <div className="flex items-start gap-2">
        <div>
          <p className="font-bold">
            {timeText(slot.startTime)}–{timeText(slot.endTime)}
          </p>
          <p className="text-xs text-muted">
            {hoursText(slot.minutes)} · {active.length}/{slot.requiredStaff} staff · {slot.applicants.length} applied
            {slot.label ? ` · ${slot.label}` : ''}
          </p>
        </div>
        {(
          <button
            type="button"
            aria-label="Delete shift"
            title="Delete shift"
            onClick={() => {
              if (window.confirm('Delete this shift?')) void run(() => rosterApi.removeSlot(slot.id))
            }}
            className="ml-auto grid size-8 place-items-center text-muted hover:text-critical"
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </button>
        )}
      </div>

      {slot.openCoverage ? (
        <p className={`mt-2 px-2 py-1 text-xs font-bold ${slot.openCoverage.isUrgent ? 'bg-red-100 text-critical' : 'bg-amber-100 text-warning'}`}>
          {slot.openCoverage.isUrgent ? 'Urgent cover needed — see Cover tab' : 'Looking for cover — see Cover tab'}
        </p>
      ) : null}

      <ul className="mt-2 space-y-1">
        {active.map((assignment) => (
          <li key={assignment.id}>
            <div className="flex items-center gap-1 bg-canvas px-2 py-1 text-sm">
              <button
                type="button"
                onClick={() => setEditing(editing === assignment.id ? null : assignment.id)}
                title={assignment.explanation ?? undefined}
                className="min-w-0 flex-1 truncate text-left font-bold"
              >
                {assignment.staffName}
                {assignment.rateOverrideSen !== null ? <span className="ml-1 text-xs text-warning">{formatRinggit(assignment.rateOverrideSen)}/h</span> : null}
              </button>
              <span className="font-mono text-[0.6rem] uppercase text-muted">{SOURCE_LABEL[assignment.source]}</span>
              <button
                type="button"
                aria-label={assignment.isLocked ? 'Unlock' : 'Lock — keep when generating again'}
                title={assignment.isLocked ? 'Locked: kept when generating again' : 'Lock it so generating again keeps it'}
                onClick={() => void run(() => rosterApi.updateAssignment(assignment.id, { isLocked: !assignment.isLocked }))}
                className={`grid size-7 place-items-center ${assignment.isLocked ? 'text-rail' : 'text-muted'}`}
              >
                {assignment.isLocked ? <Lock aria-hidden="true" className="size-3.5" /> : <LockOpen aria-hidden="true" className="size-3.5" />}
              </button>
              <button
                type="button"
                aria-label={`Take ${assignment.staffName} off`}
                onClick={() => {
                  const message =
                    detail.week.status === 'PUBLISHED'
                      ? `Take ${assignment.staffName} off this shift? The gap goes to the cover queue.`
                      : `Take ${assignment.staffName} off this shift?`
                  if (window.confirm(message)) void run(() => rosterApi.unassign(assignment.id))
                }}
                className="grid size-7 place-items-center text-muted hover:text-critical"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </div>
            {editing === assignment.id ? (
              <AssignmentEditor
                assignment={assignment}
                workTypes={workTypes}
                onClose={() => setEditing(null)}
                onChange={async (body) => run(() => rosterApi.updateAssignment(assignment.id, body))}
              />
            ) : null}
          </li>
        ))}
      </ul>

      <select
        value={adding}
        onChange={(event) => {
          setAdding(event.target.value)
          void assign(event.target.value)
        }}
        aria-label="Add someone to this shift"
        className="vista-control mt-2 w-full px-2 text-xs"
      >
        <option value="">+ Add someone…</option>
        {choices.map((staff) => (
          <option key={staff.id} value={staff.id}>
            {staff.name}
            {applicantIds.has(staff.id) ? ' (applied)' : ''}
          </option>
        ))}
      </select>

      {slot.applicants.length > 0 ? (
        <p className="mt-2 text-[0.7rem] text-muted">Applied: {slot.applicants.map((applicant) => name(applicant.staffId)).join(', ')}</p>
      ) : null}

      {warnings.length > 0 ? (
        <ul className="mt-2 space-y-0.5">
          {warnings.map((warning, index) => (
            <li key={index} className="flex gap-1 text-[0.7rem] font-bold text-warning">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-3 shrink-0" /> {warning.message}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  )
}

function AddShift({ detail, date, workTypes, onDetail, onError }: { detail: WeekDetail; date: string; workTypes: WorkType[]; onDetail: (next: WeekDetail) => void; onError: (message: string) => void }) {
  const [open, setOpen] = useState(false)
  const [startTime, setStart] = useState('17:00')
  const [endTime, setEnd] = useState('22:00')
  const [requiredStaff, setRequired] = useState(1)
  const [workTypeId, setWorkType] = useState('')

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex min-h-9 w-full items-center justify-center gap-1 border border-dashed border-line text-xs font-bold text-muted hover:text-ink">
        <Plus aria-hidden="true" className="size-3.5" /> Add shift
      </button>
    )
  }
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault()
        try {
          onDetail(
            await rosterApi.addSlot(detail.week.id, {
              date,
              startTime,
              endTime,
              requiredStaff,
              canRunSolo: requiredStaff === 1,
              roleTags: [],
              workTypeId: workTypeId || null,
              label: null,
            }),
          )
          setOpen(false)
        } catch (caught) {
          onError(errorText(caught))
        }
      }}
      className="space-y-2 border border-line bg-surface p-2 text-xs"
    >
      <div className="grid grid-cols-2 gap-1">
        <input type="time" value={startTime} onChange={(event) => setStart(event.target.value)} aria-label="Start" className="vista-control px-1" />
        <input type="time" value={endTime} onChange={(event) => setEnd(event.target.value)} aria-label="End" className="vista-control px-1" />
      </div>
      <div className="grid grid-cols-2 gap-1">
        <input type="number" min={1} value={requiredStaff} onChange={(event) => setRequired(Number(event.target.value))} aria-label="Staff needed" className="vista-control px-1" />
        <select value={workTypeId} onChange={(event) => setWorkType(event.target.value)} aria-label="Work type" className="vista-control px-1">
          <option value="">Usual</option>
          {workTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-1">
        <button type="submit" className="vista-button-primary min-h-8 flex-1">
          Add
        </button>
        <button type="button" onClick={() => setOpen(false)} className="vista-button-secondary min-h-8">
          Cancel
        </button>
      </div>
    </form>
  )
}

function FairnessTable({ detail }: { detail: WeekDetail }) {
  const rows = detail.staff
    .map((staff) => ({ staff, fairness: detail.fairness.find((entry) => entry.staffId === staff.id) }))
    .filter((row) => row.fairness && (row.fairness.appliedShifts > 0 || row.fairness.assignedShifts > 0))
  if (rows.length === 0) return null
  const most = Math.max(1, ...rows.map((row) => row.fairness?.assignedMinutes ?? 0))
  return (
    <Panel className="overflow-x-auto">
      <h3 className="text-sm font-black uppercase tracking-[0.06em]">Fairness — management only</h3>
      <table className="mt-3 w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line font-mono text-[0.62rem] uppercase tracking-[0.07em] text-muted">
            <th className="py-2 pr-3">Staff</th>
            <th className="py-2 pr-3">Applied</th>
            <th className="py-2 pr-3">Given</th>
            <th className="py-2 pr-3">Fair share</th>
            <th className="py-2 pr-3">Got / asked</th>
            <th className="py-2 pr-3">Last 4 wks</th>
            <th className="py-2">Hours this week</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ staff, fairness }) =>
            fairness ? (
              <tr key={staff.id} className="border-b border-line last:border-b-0">
                <td className="py-2 pr-3 font-bold">
                  {staff.name}
                  {staff.soloSuitability !== 'SUITABLE' ? <span className="ml-1 text-xs text-warning" title="Solo caution">●</span> : null}
                  {staff.trainingStatus === 'TRAINEE' ? <span className="ml-1 font-mono text-[0.6rem] text-muted">TRAINEE</span> : null}
                </td>
                <td className="py-2 pr-3 tabular">
                  {fairness.appliedShifts} · {hoursText(fairness.appliedMinutes)}
                </td>
                <td className="py-2 pr-3 tabular">
                  {fairness.assignedShifts} · {hoursText(fairness.assignedMinutes)}
                </td>
                <td className="py-2 pr-3 tabular">{hoursText(fairness.fairShareMinutes)}</td>
                <td className="py-2 pr-3 tabular">{fairness.fillRate === null ? '—' : `${Math.round(fairness.fillRate * 100)}%`}</td>
                <td className="py-2 pr-3 tabular">{hoursText(staff.trailingMinutes)}</td>
                <td className="py-2">
                  <span className="block h-2 bg-rail/15">
                    <span className="block h-2 bg-rail" style={{ width: `${(fairness.assignedMinutes / most) * 100}%` }} />
                  </span>
                </td>
              </tr>
            ) : null,
          )}
        </tbody>
      </table>
    </Panel>
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
  const [message, setMessage] = useState<{ tone: 'error' | 'warn'; text: string[] } | null>(null)
  const [sharing, setSharing] = useState(false)

  const warningsBySlot = useMemo(() => {
    const map = new Map<string, RosterWarning[]>()
    for (const warning of data?.warnings ?? []) {
      if (!warning.slotId || warning.kind === 'UNFILLED' || warning.kind === 'DID_NOT_APPLY') continue
      map.set(warning.slotId, [...(map.get(warning.slotId) ?? []), warning])
    }
    return map
  }, [data])

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
      setMessage({ tone: 'error', text: [errorText(caught)] })
    } finally {
      setBusy(false)
    }
  }

  const days = Array.from({ length: 7 }, (_, index) => addDaysTo(data.week.weekStart, index))
  const unfilled = data.warnings.filter((warning) => warning.kind === 'UNFILLED').length
  const staffWarnings = data.warnings.filter((warning) => !warning.slotId)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h3 className="font-display text-2xl font-bold">Week of {dayName(data.week.weekStart, 'long')}</h3>
          <p className="text-xs text-muted">
            {PHASE_LABEL[data.week.phase] ?? data.week.phase} · last updated {dateTimeText(data.week.updatedAt)}
            {data.week.publishedAt ? ` · published ${dateTimeText(data.week.publishedAt)}` : ''}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => setSharing(true)} className="vista-button-secondary flex min-h-11 items-center gap-2">
            <ImageIcon aria-hidden="true" className="size-4" /> <Printer aria-hidden="true" className="size-4" /> Export
          </button>
          {data.week.status !== 'PUBLISHED' ? (
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm('Delete this whole week and its shifts?')) return
                try {
                  await rosterApi.deleteWeek(data.week.id)
                  onDeleted()
                } catch (caught) {
                  setMessage({ tone: 'error', text: [errorText(caught)] })
                }
              }}
              className="min-h-11 border border-critical/40 px-3 text-xs font-bold text-critical"
            >
              Delete week
            </button>
          ) : null}
        </div>
      </div>

      <StageBar detail={data} busy={busy} onAction={act} />
      <WeekRules key={data.week.version} detail={data} onSaved={update} />

      {message ? (
        <div role={message.tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 p-3 text-sm font-bold ${message.tone === 'error' ? 'bg-red-50 text-critical' : 'bg-amber-50 text-warning'}`}>
          <div className="flex-1 space-y-1">
            {message.tone === 'warn' ? <p>Done — but note:</p> : null}
            {message.text.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          <button type="button" aria-label="Dismiss" onClick={() => setMessage(null)}>
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 text-xs">
        <Badge tone={unfilled ? 'warning' : 'good'}>{unfilled ? `${unfilled} shift${unfilled === 1 ? '' : 's'} short` : 'Every shift filled'}</Badge>
        {staffWarnings.map((warning, index) => (
          <Badge key={index} tone="warning">
            {warning.message}
          </Badge>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
        {days.map((date) => {
          const slots = data.slots.filter((slot) => slot.date === date)
          return (
            <section key={date} className="space-y-2">
              <h4 className="font-mono text-xs font-bold uppercase tracking-[0.06em] text-muted">{dayName(date)}</h4>
              {slots.map((slot) => (
                <SlotCard
                  key={slot.id}
                  slot={slot}
                  detail={data}
                  workTypes={workTypes}
                  warnings={warningsBySlot.get(slot.id) ?? []}
                  onDetail={update}
                  onWarnings={(warnings) => setMessage({ tone: 'warn', text: warnings.map((warning) => warning.message) })}
                  onError={(text) => setMessage({ tone: 'error', text: [text] })}
                />
              ))}
              <AddShift detail={data} date={date} workTypes={workTypes} onDetail={update} onError={(text) => setMessage({ tone: 'error', text: [text] })} />
            </section>
          )
        })}
      </div>

      <FairnessTable detail={data} />

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
          existing={weeks}
          onCreated={(detail) => {
            setSelected(detail.week.id)
            reload()
          }}
        />
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
                  {PHASE_LABEL[week.phase] ?? week.phase} · {week.filled}/{week.seats} filled · {week.applicantCount} applied
                </span>
              </button>
            </li>
          ))}
        </ul>
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
        <EmptyState title="No roster weeks yet" hint="Set up the usual week in Timetable, then create a week on the left." />
      )}
    </div>
  )
}
