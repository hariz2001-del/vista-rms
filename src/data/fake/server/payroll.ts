import { workTimes } from './roster.ts'
import {
  addDays,
  businessToday,
  dateRange,
  lineAmountSen,
  minutesBetween,
  mytDate,
  mytTime,
  payableMinutes,
  rangeLabel,
  recentPeriods,
  resolveRate,
  type ResolvedRate,
  type Rounding,
} from './rules.ts'
import {
  audit,
  badRequest,
  conflict,
  has,
  ISO_DATE,
  MANAGEMENT,
  newId,
  notFound,
  optStr,
  type AttendanceRow,
  type Ctx,
  type DemoServerState,
  type Route,
  type StoredLine,
} from './state.ts'

/**
 * Attendance review and payroll — api-vista src/routes/team-payroll.ts and
 * src/team/payroll-data.ts. Roster is what was planned, attendance is what
 * happened, and payroll pays only approved attendance: approved → a draft
 * worked out live → approved payslip (lines snapshotted) → paid (frozen).
 */

const ms = (iso: string) => Date.parse(iso)

function roundingFor(state: DemoServerState): Rounding {
  return { minutes: state.settings.payRoundingMinutes, mode: state.settings.payRoundingMode }
}

function namedRate(state: DemoServerState, id: string | null | undefined) {
  const type = id ? state.workTypes.find((candidate) => candidate.id === id) : undefined
  return type ? { name: type.name, rateSenPerHour: type.rateSenPerHour } : null
}

/** The rate for one piece of attendance, most specific first. */
export function rateFor(state: DemoServerState, record: AttendanceRow): ResolvedRate {
  const assignment = record.assignmentId ? state.assignments.find((row) => row.id === record.assignmentId) : undefined
  const slot = assignment ? state.slots.find((row) => row.id === assignment.slotId) : undefined
  const staff = state.staff.find((row) => row.id === record.staffId)
  return resolveRate({
    rateOverrideSen: assignment?.rateOverrideSen ?? null,
    attendanceWorkType: namedRate(state, record.workTypeId),
    assignmentWorkType: namedRate(state, assignment?.workTypeId),
    slotWorkType: namedRate(state, slot?.workTypeId),
    staffDefaultWorkType: namedRate(state, staff?.defaultWorkTypeId),
  })
}

export type DraftLine = StoredLine & { attendanceVersion: number | null; approvedStartAt: string | null; approvedEndAt: string | null }

/** One approved record as a payslip line, or null if no rate applies. */
function attendanceLine(state: DemoServerState, record: AttendanceRow): DraftLine | null {
  const start = record.approvedStartAt ?? record.clockInAt
  const end = record.approvedEndAt ?? record.clockOutAt
  if (!end) return null
  const rate = rateFor(state, record)
  if (!rate) return null
  const minutes = payableMinutes(start, end, roundingFor(state))
  const at = (value: string | null) => (value ? ms(value) : undefined)
  const edited = at(record.approvedStartAt) !== ms(record.clockInAt) || at(record.approvedEndAt) !== at(record.clockOutAt)
  const assignment = record.assignmentId ? state.assignments.find((row) => row.id === record.assignmentId) : undefined
  const slot = assignment ? state.slots.find((row) => row.id === assignment.slotId) : undefined
  return {
    kind: 'ATTENDANCE',
    attendanceId: record.id,
    attendanceVersion: record.version,
    adjustmentId: null,
    workDate: mytDate(start),
    clockInAt: record.clockInAt,
    clockOutAt: record.clockOutAt,
    approvedStartAt: start,
    approvedEndAt: end,
    minutes,
    workTypeName: rate.workTypeName,
    rateSenPerHour: rate.rateSenPerHour,
    amountSen: lineAmountSen(minutes, rate.rateSenPerHour),
    description: edited ? 'Times adjusted by management' : (slot?.label ?? null),
  }
}

const inRange = (iso: string, span: { gte: number; lt: number }) => ms(iso) >= span.gte && ms(iso) < span.lt

type Draft = {
  lines: DraftLine[]
  pendingCount: number
  missingRate: Array<{ attendanceId: string; date: string }>
  missingEnd: Array<{ attendanceId: string; date: string }>
}

/**
 * What someone is owed for a period, worked out now: approved records that
 * start in it and are not on a payslip yet, plus their open adjustments.
 */
export function draftFor(state: DemoServerState, staffId: string, start: string, end: string): Draft {
  const span = dateRange(start, end)
  const taken = new Set(
    state.payslips.filter((payslip) => payslip.staffId === staffId).flatMap((payslip) => payslip.lines.map((line) => line.attendanceId)),
  )
  const records = state.attendance
    .filter((record) => record.staffId === staffId && inRange(record.clockInAt, span) && !taken.has(record.id))
    .toSorted((a, b) => ms(a.clockInAt) - ms(b.clockInAt))

  const lines: DraftLine[] = []
  const missingRate: Draft['missingRate'] = []
  const missingEnd: Draft['missingEnd'] = []
  for (const record of records.filter((candidate) => candidate.status === 'APPROVED')) {
    const date = mytDate(record.approvedStartAt ?? record.clockInAt)
    if (!(record.approvedEndAt ?? record.clockOutAt)) {
      missingEnd.push({ attendanceId: record.id, date })
      continue
    }
    const line = attendanceLine(state, record)
    if (!line) missingRate.push({ attendanceId: record.id, date })
    else lines.push(line)
  }
  for (const adjustment of state.adjustments.filter((row) => row.staffId === staffId && row.status === 'OPEN')) {
    lines.push({
      kind: 'ADJUSTMENT',
      attendanceId: adjustment.attendanceId,
      attendanceVersion: null,
      adjustmentId: adjustment.id,
      workDate: mytDate(adjustment.createdAt),
      clockInAt: null,
      clockOutAt: null,
      approvedStartAt: null,
      approvedEndAt: null,
      minutes: adjustment.minutesDelta,
      workTypeName: 'Adjustment',
      rateSenPerHour: 0,
      amountSen: adjustment.amountSen,
      description: adjustment.reason,
    })
  }
  return { lines, pendingCount: records.filter((record) => record.status === 'PENDING').length, missingRate, missingEnd }
}

/** Return an approved, unpaid payslip to draft. Its adjustments become open again. */
function revertPayslip(ctx: Pick<Ctx, 'state' | 'now'>, payslipId: string, action: string): void {
  const { state } = ctx
  const payslip = state.payslips.find((row) => row.id === payslipId)
  if (!payslip || payslip.status !== 'APPROVED') return
  for (const adjustment of state.adjustments.filter((row) => row.includedInPayslipId === payslipId)) {
    Object.assign(adjustment, { status: 'OPEN', includedInPayslipId: null, resolvedAt: null })
  }
  state.payslips = state.payslips.filter((row) => row.id !== payslipId)
  audit(ctx, MANAGEMENT, {
    action,
    entityType: 'payslip',
    entityId: payslipId,
    before: { staffId: payslip.staffId, totalSen: payslip.totalSen, periodStart: payslip.periodStart, periodEnd: payslip.periodEnd },
  })
}

/**
 * A record changed after it was put on a payslip. On an approved one, that
 * payslip goes back to draft; on a paid one the paid amount stays and the
 * difference becomes an open adjustment.
 */
export function attendanceChanged(ctx: Pick<Ctx, 'state' | 'now'>, attendanceId: string): void {
  const { state, now } = ctx
  const lines = state.payslips.flatMap((payslip) =>
    payslip.lines.filter((line) => line.attendanceId === attendanceId && line.kind === 'ATTENDANCE').map((line) => ({ line, payslip })),
  )
  for (const { line, payslip } of lines) {
    if (payslip.status === 'APPROVED') {
      revertPayslip(ctx, payslip.id, 'payroll.reverted_after_attendance_edit')
      continue
    }
    const record = state.attendance.find((row) => row.id === attendanceId)
    const current = record && record.status === 'APPROVED' ? attendanceLine(state, record) : null
    const shouldBeSen = current?.amountSen ?? 0
    const shouldBeMinutes = current?.minutes ?? 0
    const owed = (statuses: string[]) =>
      state.adjustments.filter((row) => row.attendanceId === attendanceId && row.causePayslipId === payslip.id && statuses.includes(row.status))
    const already = owed(['OPEN', 'INCLUDED'])
    const difference = shouldBeSen - line.amountSen - already.reduce((sum, row) => sum + row.amountSen, 0)
    const minutesDifference = shouldBeMinutes - line.minutes - already.reduce((sum, row) => sum + row.minutesDelta, 0)
    if (difference === 0 && minutesDifference === 0) continue

    // Only one open adjustment stands for a record.
    for (const row of owed(['OPEN'])) {
      Object.assign(row, { status: 'DISMISSED', resolvedAt: now.toISOString(), resolvedNote: 'Superseded by a later change to the same attendance.' })
    }
    const included = owed(['INCLUDED'])
    const amountSen = shouldBeSen - line.amountSen - included.reduce((sum, row) => sum + row.amountSen, 0)
    const minutes = shouldBeMinutes - line.minutes - included.reduce((sum, row) => sum + row.minutesDelta, 0)
    if (amountSen === 0 && minutes === 0) continue
    const money = `RM ${(Math.abs(amountSen) / 100).toFixed(2)}`
    const adjustment = {
      id: newId(state),
      staffId: payslip.staffId,
      attendanceId,
      causePayslipId: payslip.id,
      includedInPayslipId: null,
      amountSen,
      minutesDelta: minutes,
      reason:
        amountSen >= 0
          ? `Attendance on ${line.workDate} changed after payroll was paid. ${money} more may be owed.`
          : `Attendance on ${line.workDate} changed after payroll was paid. ${money} may have been overpaid.`,
      status: 'OPEN' as const,
      resolvedNote: null,
      resolvedAt: null,
      createdAt: now.toISOString(),
    }
    state.adjustments.push(adjustment)
    audit(ctx, MANAGEMENT, {
      action: 'payroll.discrepancy_flagged',
      entityType: 'payroll_adjustment',
      entityId: adjustment.id,
      after: { attendanceId, paidPayslipId: payslip.id, amountSen, minutesDelta: minutes },
    })
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function rangeQuery(query: URLSearchParams): { start: string; end: string } {
  const start = query.get('start') ?? ''
  const end = query.get('end') ?? ''
  if (!ISO_DATE.test(start) || !ISO_DATE.test(end)) badRequest('demo:INVALID')
  return { start, end }
}

function instantOf(value: unknown): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return badRequest('demo:INVALID')
  return new Date(value).toISOString()
}

function requireRecord(state: DemoServerState, id: string): AttendanceRow {
  return state.attendance.find((row) => row.id === id) ?? notFound('team:ATTENDANCE_NOT_FOUND')
}

function listAttendance({ state, query }: Ctx) {
  const { start, end } = rangeQuery(query)
  const status = query.get('status')
  const staffId = query.get('staffId')
  const window = dateRange(start, end)
  const rounding = roundingFor(state)
  const payslipStatus = new Map(
    state.payslips.flatMap((payslip) =>
      payslip.lines.filter((line) => line.kind === 'ATTENDANCE').map((line) => [line.attendanceId, payslip.status] as const),
    ),
  )
  return {
    attendance: state.attendance
      .filter((record) => inRange(record.clockInAt, window) && (!status || record.status === status) && (!staffId || record.staffId === staffId))
      .toSorted((a, b) => ms(a.clockInAt) - ms(b.clockInAt))
      .map((record) => {
        const begin = record.approvedStartAt ?? record.clockInAt
        const finish = record.approvedEndAt ?? record.clockOutAt
        const rate = rateFor(state, record)
        const assignment = record.assignmentId ? state.assignments.find((row) => row.id === record.assignmentId) : undefined
        const slot = assignment ? state.slots.find((row) => row.id === assignment.slotId) : undefined
        return {
          id: record.id,
          staffId: record.staffId,
          staffName: state.staff.find((row) => row.id === record.staffId)?.name ?? '',
          status: record.status,
          source: record.source,
          date: mytDate(record.clockInAt),
          clockInAt: record.clockInAt,
          clockOutAt: record.clockOutAt,
          approvedStartAt: record.approvedStartAt,
          approvedEndAt: record.approvedEndAt,
          shift: slot ? { startTime: mytTime(slot.startsAt), endTime: mytTime(slot.endsAt), label: slot.label } : null,
          assignmentId: record.assignmentId,
          workTypeId: record.workTypeId,
          note: record.note,
          payableMinutes: finish ? payableMinutes(begin, finish, rounding) : null,
          workedMinutes: finish ? minutesBetween(begin, finish) : null,
          rate: rate ? { workTypeName: rate.workTypeName, rateSenPerHour: rate.rateSenPerHour } : null,
          payslipStatus: payslipStatus.get(record.id) ?? null,
          flags: [...(record.clockOutAt ? [] : ['NO_CLOCK_OUT']), ...(record.assignmentId ? [] : ['UNROSTERED']), ...(rate ? [] : ['NO_RATE'])],
        }
      }),
  }
}

/** Finished shifts on a published roster that nobody has confirmed yet. */
function unconfirmed({ state, query, now }: Ctx) {
  const { start, end } = rangeQuery(query)
  const window = dateRange(start, end)
  const published = new Set(state.weeks.filter((week) => week.status === 'PUBLISHED').map((week) => week.id))
  const confirmed = new Set(state.attendance.filter((row) => row.status !== 'REJECTED').map((row) => row.assignmentId))
  const staffName = (id: string) => state.staff.find((row) => row.id === id)?.name ?? ''
  return {
    shifts: state.assignments
      .flatMap((assignment) => {
        const slot = state.slots.find((row) => row.id === assignment.slotId)
        if (!slot || assignment.status !== 'ACTIVE' || confirmed.has(assignment.id) || !published.has(slot.weekId)) return []
        if (!inRange(slot.startsAt, window) || ms(slot.endsAt) > now.getTime()) return []
        return [{ assignment, slot }]
      })
      .toSorted((a, b) => ms(a.slot.startsAt) - ms(b.slot.startsAt) || staffName(a.assignment.staffId).localeCompare(staffName(b.assignment.staffId)))
      .map(({ assignment, slot }) => {
        const times = workTimes(assignment, slot)
        return {
          assignmentId: assignment.id,
          staffId: assignment.staffId,
          staffName: staffName(assignment.staffId),
          date: mytDate(slot.startsAt),
          startTime: mytTime(times.startsAt),
          endTime: mytTime(times.endsAt),
          startsAt: times.startsAt,
          endsAt: times.endsAt,
          minutes: minutesBetween(times.startsAt, times.endsAt),
          label: assignment.isBackup ? `Backup${slot.label ? ` · ${slot.label}` : ''}` : slot.label,
        }
      }),
  }
}

/** Confirm rostered shifts as worked, at their rostered times. Approved at once. */
export function confirmFromRoster(ctx: Ctx) {
  const { state, now } = ctx
  const ids = Array.isArray(ctx.body.assignmentIds) ? (ctx.body.assignmentIds as string[]) : badRequest('demo:INVALID')
  let count = 0
  for (const assignment of state.assignments.filter((row) => ids.includes(row.id) && row.status === 'ACTIVE')) {
    // Already confirmed (a double tap): leave it.
    if (state.attendance.some((row) => row.assignmentId === assignment.id && row.status !== 'REJECTED')) continue
    const slot = state.slots.find((row) => row.id === assignment.slotId)
    if (!slot) continue
    const times = workTimes(assignment, slot)
    const record: AttendanceRow = {
      id: newId(state),
      staffId: assignment.staffId,
      assignmentId: assignment.id,
      clockInAt: times.startsAt,
      clockOutAt: times.endsAt,
      approvedStartAt: times.startsAt,
      approvedEndAt: times.endsAt,
      workTypeId: null,
      note: 'Worked as rostered',
      source: 'MANUAL',
      status: 'APPROVED',
      approvedAt: now.toISOString(),
      version: 1,
    }
    state.attendance.push(record)
    audit(ctx, MANAGEMENT, {
      action: 'attendance.confirmed_from_roster',
      entityType: 'attendance',
      entityId: record.id,
      after: { assignmentId: assignment.id, staffId: assignment.staffId },
    })
    count += 1
  }
  return { confirmed: count }
}

/** Time management records by hand. Approved as it is entered. */
function addAttendance(ctx: Ctx) {
  const { state, body, now } = ctx
  const start = instantOf(body.startAt)
  const end = instantOf(body.endAt)
  if (ms(end) <= ms(start)) badRequest('team:TIMES_BACKWARDS')
  const staffId = typeof body.staffId === 'string' ? body.staffId : ''
  if (!state.staff.some((row) => row.id === staffId)) notFound('team:STAFF_NOT_FOUND')
  const assignmentId = typeof body.assignmentId === 'string' ? body.assignmentId : null
  if (assignmentId && state.assignments.find((row) => row.id === assignmentId)?.staffId !== staffId) badRequest('team:ASSIGNMENT_NOT_FOUND')
  const workTypeId = typeof body.workTypeId === 'string' ? body.workTypeId : null
  if (workTypeId && !state.workTypes.some((type) => type.id === workTypeId)) badRequest('team:WORK_TYPE_NOT_FOUND')
  const record: AttendanceRow = {
    id: newId(state),
    staffId,
    assignmentId,
    clockInAt: start,
    clockOutAt: end,
    approvedStartAt: start,
    approvedEndAt: end,
    workTypeId,
    note: optStr(body, 'note') ?? null,
    source: 'MANUAL',
    status: 'APPROVED',
    approvedAt: now.toISOString(),
    version: 1,
  }
  state.attendance.push(record)
  audit(ctx, MANAGEMENT, { action: 'attendance.added_manually', entityType: 'attendance', entityId: record.id, after: body })
  return { id: record.id }
}

/** Edit times, work type or note. A payslip it is on reacts (see attendanceChanged). */
export function editAttendance(ctx: Ctx) {
  const { state, body } = ctx
  const record = requireRecord(state, ctx.params.id ?? '')
  const start = has(body, 'approvedStartAt') ? instantOf(body.approvedStartAt) : (record.approvedStartAt ?? record.clockInAt)
  const end = has(body, 'approvedEndAt')
    ? instantOf(body.approvedEndAt)
    : (record.approvedEndAt ?? (has(body, 'clockOutAt') ? instantOf(body.clockOutAt) : record.clockOutAt))
  if (end && ms(end) <= ms(start)) badRequest('team:TIMES_BACKWARDS')
  if (has(body, 'clockOutAt') && ms(instantOf(body.clockOutAt)) <= ms(record.clockInAt)) badRequest('team:TIMES_BACKWARDS')
  if (body.workTypeId && !state.workTypes.some((type) => type.id === body.workTypeId)) badRequest('team:WORK_TYPE_NOT_FOUND')
  const before = { approvedStartAt: record.approvedStartAt, approvedEndAt: record.approvedEndAt, clockOutAt: record.clockOutAt, workTypeId: record.workTypeId }
  if (has(body, 'approvedStartAt')) record.approvedStartAt = instantOf(body.approvedStartAt)
  if (has(body, 'approvedEndAt')) record.approvedEndAt = instantOf(body.approvedEndAt)
  if (has(body, 'clockOutAt')) record.clockOutAt = instantOf(body.clockOutAt)
  if (has(body, 'workTypeId')) record.workTypeId = (body.workTypeId as string | null) ?? null
  if (has(body, 'assignmentId')) record.assignmentId = (body.assignmentId as string | null) ?? null
  if (has(body, 'note')) record.note = optStr(body, 'note') ?? null
  record.version += 1
  audit(ctx, MANAGEMENT, {
    action: 'attendance.edited',
    entityType: 'attendance',
    entityId: record.id,
    before,
    after: { approvedStartAt: record.approvedStartAt, approvedEndAt: record.approvedEndAt, clockOutAt: record.clockOutAt, workTypeId: record.workTypeId },
  })
  attendanceChanged(ctx, record.id)
  return { ok: true }
}

export function approveAttendance(ctx: Ctx) {
  const { state, body, now } = ctx
  const record = requireRecord(state, ctx.params.id ?? '')
  const start = has(body, 'approvedStartAt') ? instantOf(body.approvedStartAt) : (record.approvedStartAt ?? record.clockInAt)
  const end = has(body, 'approvedEndAt') ? instantOf(body.approvedEndAt) : (record.approvedEndAt ?? record.clockOutAt)
  if (!end) return badRequest('team:NO_CLOCK_OUT')
  if (ms(end) <= ms(start)) badRequest('team:TIMES_BACKWARDS')
  const was = record.status
  Object.assign(record, {
    status: 'APPROVED',
    approvedStartAt: start,
    approvedEndAt: end,
    approvedAt: now.toISOString(),
    clockOutAt: record.clockOutAt ?? end,
    version: record.version + 1,
  })
  audit(ctx, MANAGEMENT, { action: 'attendance.approved', entityType: 'attendance', entityId: record.id, before: { status: was }, after: { approvedStartAt: start, approvedEndAt: end } })
  if (was === 'APPROVED') attendanceChanged(ctx, record.id)
  return { ok: true }
}

function rejectAttendance(ctx: Ctx) {
  const { state, body, now } = ctx
  const record = requireRecord(state, ctx.params.id ?? '')
  const was = record.status
  const note = optStr(body, 'note') ?? null
  Object.assign(record, {
    status: 'REJECTED',
    // A rejected open clock-in is closed off so the person can clock in again.
    clockOutAt: record.clockOutAt ?? new Date(Math.max(now.getTime(), ms(record.clockInAt) + 60_000)).toISOString(),
    note: note ?? record.note,
    version: record.version + 1,
  })
  audit(ctx, MANAGEMENT, { action: 'attendance.rejected', entityType: 'attendance', entityId: record.id, before: { status: was }, after: { note } })
  if (was === 'APPROVED') attendanceChanged(ctx, record.id)
  return { ok: true }
}

function periods({ state, now }: Ctx) {
  const today = businessToday(now)
  const { payFrequency, payAnchorDate, paydayOffsetDays } = state.settings
  return {
    frequency: payFrequency,
    today,
    periods: recentPeriods(today, payFrequency, payAnchorDate, 8).map((period) => ({
      ...period,
      label: rangeLabel(period.start, period.end),
      payday: addDays(period.end, paydayOffsetDays),
    })),
  }
}

function hoursByType(lines: Array<{ workTypeName: string; minutes: number; kind: string }>) {
  const byType: Record<string, number> = {}
  for (const line of lines) {
    if (line.kind !== 'ATTENDANCE') continue
    const key = line.workTypeName.replace(/ \(special rate\)$/, '')
    byType[key] = (byType[key] ?? 0) + line.minutes
  }
  return byType
}

const attendanceSum = (lines: DraftLine[], key: 'minutes' | 'amountSen') =>
  lines.filter((line) => line.kind === 'ATTENDANCE').reduce((sum, line) => sum + line[key], 0)

const problemsOf = (draft: Draft) => [
  ...draft.missingRate.map((item) => `No work type or rate for ${item.date}.`),
  ...draft.missingEnd.map((item) => `No end time on ${item.date}.`),
]

/** One line per staff member for a period: hours by work type, amount, status. */
export function payrollSummary({ state, query }: Ctx) {
  const { start, end } = rangeQuery(query)
  if (end < start) badRequest('team:RANGE_BACKWARDS')
  const window = dateRange(start, end)
  const payslips = state.payslips.filter((payslip) => payslip.periodStart === start && payslip.periodEnd === end)
  const staffIds = new Set([
    ...state.attendance.filter((row) => inRange(row.clockInAt, window) && row.status !== 'REJECTED').map((row) => row.staffId),
    ...payslips.map((row) => row.staffId),
    ...state.adjustments.filter((row) => row.status === 'OPEN').map((row) => row.staffId),
  ])
  const rows = []
  for (const member of state.staff.filter((staff) => staffIds.has(staff.id)).toSorted((a, b) => a.name.localeCompare(b.name))) {
    const stored = payslips.find((payslip) => payslip.staffId === member.id)
    const draft = draftFor(state, member.id, start, end)
    const base = { staffId: member.id, name: member.name, staffCode: member.staffCode, pendingCount: draft.pendingCount }
    const openAdjustments = draft.lines.filter((line) => line.kind === 'ADJUSTMENT').length
    if (stored) {
      rows.push({
        ...base,
        status: stored.status,
        payslipId: stored.id,
        minutesByType: hoursByType(stored.lines),
        totalMinutes: stored.totalMinutes,
        totalSen: stored.totalSen,
        paidAt: stored.paidAt,
        // Approved later, after this payslip: worth knowing before paying.
        unpaidAfterPayslipSen: attendanceSum(draft.lines, 'amountSen'),
        openAdjustments,
        problems: [],
      })
      continue
    }
    if (draft.lines.length === 0 && draft.pendingCount === 0 && draft.missingEnd.length === 0 && draft.missingRate.length === 0) continue
    rows.push({
      ...base,
      status: 'DRAFT',
      payslipId: null,
      minutesByType: hoursByType(draft.lines),
      totalMinutes: attendanceSum(draft.lines, 'minutes'),
      totalSen: draft.lines.reduce((sum, line) => sum + line.amountSen, 0),
      paidAt: null,
      unpaidAfterPayslipSen: 0,
      openAdjustments,
      problems: problemsOf(draft),
    })
  }
  return { start, end, label: rangeLabel(start, end), rows }
}

function payslipDetail({ state, params, query }: Ctx) {
  const { start, end } = rangeQuery(query)
  const member = state.staff.find((row) => row.id === params.staffId) ?? notFound('team:STAFF_NOT_FOUND')
  const staff = { id: member.id, name: member.name, staffCode: member.staffCode }
  const stored = state.payslips.find((row) => row.staffId === member.id && row.periodStart === start && row.periodEnd === end)
  if (stored) {
    return {
      staff,
      start,
      end,
      status: stored.status,
      payslipId: stored.id,
      lines: stored.lines,
      totalMinutes: stored.totalMinutes,
      totalSen: stored.totalSen,
      approvedAt: stored.approvedAt,
      paidAt: stored.paidAt,
      paidOn: stored.paidOn,
      expenseId: null,
      problems: [],
      pendingCount: 0,
    }
  }
  const draft = draftFor(state, member.id, start, end)
  return {
    staff,
    start,
    end,
    status: 'DRAFT',
    payslipId: null,
    lines: draft.lines,
    totalMinutes: attendanceSum(draft.lines, 'minutes'),
    totalSen: draft.lines.reduce((sum, line) => sum + line.amountSen, 0),
    approvedAt: null,
    paidAt: null,
    paidOn: null,
    expenseId: null,
    problems: problemsOf(draft),
    pendingCount: draft.pendingCount,
  }
}

/** Snapshot a draft into an approved payslip. Not final until paid. */
export function approvePayslip(ctx: Ctx) {
  const { state, body, now } = ctx
  const staffId = typeof body.staffId === 'string' ? body.staffId : ''
  const start = typeof body.start === 'string' ? body.start : ''
  const end = typeof body.end === 'string' ? body.end : ''
  if (!ISO_DATE.test(start) || !ISO_DATE.test(end)) badRequest('demo:INVALID')
  if (end < start) badRequest('team:RANGE_BACKWARDS')
  if (state.payslips.some((row) => row.staffId === staffId && row.periodStart === start && row.periodEnd === end)) conflict('team:PAYSLIP_EXISTS')
  const draft = draftFor(state, staffId, start, end)
  if (draft.missingRate.length > 0) badRequest('team:NO_RATE')
  if (draft.lines.length === 0) badRequest('team:NOTHING_TO_PAY')
  const created = {
    id: newId(state),
    staffId,
    periodStart: start,
    periodEnd: end,
    status: 'APPROVED' as const,
    totalMinutes: attendanceSum(draft.lines, 'minutes'),
    totalSen: draft.lines.reduce((sum, line) => sum + line.amountSen, 0),
    approvedAt: now.toISOString(),
    paidAt: null,
    paidOn: null,
    // As stored: the approved times become the line's clock times.
    lines: draft.lines.map(
      (line): StoredLine => ({
        kind: line.kind,
        attendanceId: line.attendanceId,
        adjustmentId: line.adjustmentId,
        workDate: line.workDate,
        clockInAt: line.approvedStartAt,
        clockOutAt: line.approvedEndAt,
        minutes: line.minutes,
        workTypeName: line.workTypeName,
        rateSenPerHour: line.rateSenPerHour,
        amountSen: line.amountSen,
        description: line.description,
      }),
    ),
  }
  state.payslips.push(created)
  for (const line of draft.lines) {
    const adjustment = state.adjustments.find((row) => row.id === line.adjustmentId && row.status === 'OPEN')
    if (adjustment) Object.assign(adjustment, { status: 'INCLUDED', includedInPayslipId: created.id, resolvedAt: now.toISOString() })
  }
  audit(ctx, MANAGEMENT, {
    action: 'payroll.approved',
    entityType: 'payslip',
    entityId: created.id,
    after: { staffId, start, end, totalSen: created.totalSen, lines: created.lines.length },
  })
  return { payslipId: created.id, totalSen: created.totalSen }
}

function unapprove(ctx: Ctx) {
  const found = ctx.state.payslips.find((row) => row.id === ctx.params.id) ?? notFound('team:PAYSLIP_NOT_FOUND')
  if (found.status === 'PAID') conflict('team:PAYSLIP_PAID')
  revertPayslip(ctx, found.id, 'payroll.unapproved')
  return { ok: true }
}

/**
 * Mark a payslip paid, once. The real server also books a Wages expense and
 * its ledger line here; the demo's books are generated, so it only freezes
 * the payslip.
 */
export function pay(ctx: Ctx) {
  const { state, body, now } = ctx
  const found = state.payslips.find((row) => row.id === ctx.params.id) ?? notFound('team:PAYSLIP_NOT_FOUND')
  if (found.status === 'PAID') return { replayed: true, expenseId: null, ledgerEntryId: null }
  const paidOn = typeof body.paidOn === 'string' && ISO_DATE.test(body.paidOn) ? body.paidOn : businessToday(now)
  Object.assign(found, { status: 'PAID', paidAt: now.toISOString(), paidOn })
  const member = state.staff.find((row) => row.id === found.staffId)
  audit(ctx, MANAGEMENT, { action: 'payroll.paid', entityType: 'payslip', entityId: found.id, after: { totalSen: found.totalSen, paidOn } })
  audit(ctx, MANAGEMENT, {
    action: 'ledger.wages_entry_created',
    entityType: 'ledger_entry',
    after: {
      description: `${member?.name ?? ''} — Payroll ${rangeLabel(found.periodStart, found.periodEnd)}`,
      amountSen: found.totalSen,
      payslipId: found.id,
      staffId: found.staffId,
    },
  })
  return { replayed: false, expenseId: null, ledgerEntryId: null }
}

function adjustments({ state }: Ctx) {
  return {
    adjustments: state.adjustments
      .toSorted((a, b) => ms(b.createdAt) - ms(a.createdAt))
      .slice(0, 200)
      .map((row) => ({
        id: row.id,
        staffId: row.staffId,
        staffName: state.staff.find((staff) => staff.id === row.staffId)?.name ?? '',
        amountSen: row.amountSen,
        minutesDelta: row.minutesDelta,
        reason: row.reason,
        status: row.status,
        causePayslipId: row.causePayslipId,
        includedInPayslipId: row.includedInPayslipId,
        resolvedNote: row.resolvedNote,
        createdAt: row.createdAt,
      })),
  }
}

function dismissAdjustment(ctx: Ctx) {
  const note = optStr(ctx.body, 'note')
  if (!note) return badRequest('demo:INVALID')
  const row = ctx.state.adjustments.find((candidate) => candidate.id === ctx.params.id && candidate.status === 'OPEN') ?? conflict('team:ADJUSTMENT_CLOSED')
  Object.assign(row, { status: 'DISMISSED', resolvedNote: note, resolvedAt: ctx.now.toISOString() })
  audit(ctx, MANAGEMENT, { action: 'payroll.adjustment_dismissed', entityType: 'payroll_adjustment', entityId: row.id, after: { note } })
  return { ok: true }
}

export const payrollRoutes: Route[] = [
  ['GET', '/rms/team/attendance', listAttendance],
  ['GET', '/rms/team/attendance/unconfirmed', unconfirmed],
  ['POST', '/rms/team/attendance/from-roster', confirmFromRoster],
  ['POST', '/rms/team/attendance', addAttendance],
  ['PATCH', '/rms/team/attendance/:id', editAttendance],
  ['POST', '/rms/team/attendance/:id/approve', approveAttendance],
  ['POST', '/rms/team/attendance/:id/reject', rejectAttendance],
  ['GET', '/rms/team/payroll/periods', periods],
  ['GET', '/rms/team/payroll', payrollSummary],
  ['GET', '/rms/team/payroll/staff/:staffId', payslipDetail],
  ['POST', '/rms/team/payroll/approve', approvePayslip],
  ['POST', '/rms/team/payslips/:id/unapprove', unapprove],
  ['POST', '/rms/team/payslips/:id/pay', pay],
  ['GET', '/rms/team/adjustments', adjustments],
  ['POST', '/rms/team/adjustments/:id/dismiss', dismissAdjustment],
]
