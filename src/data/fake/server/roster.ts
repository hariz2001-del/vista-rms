import type { SlotTemplate } from '../../roster-api.ts'
import {
  evaluateRoster,
  generateRoster,
  rankReplacements,
  warningsForPlacement,
  weightsFrom,
  type EngineInput,
  type EngineStaff,
  type Placement,
} from './rostering.ts'
import { addDays, minutesBetween, mytDate, mytTime, rangeLabel, shiftInstants, weekdayOf } from './rules.ts'
import {
  audit,
  badRequest,
  conflict,
  demoOnly,
  has,
  HHMM,
  ISO_DATE,
  MANAGEMENT,
  newId,
  notFound,
  optStr,
  SYSTEM,
  type Actor,
  type AssignmentRow,
  type Ctx,
  type DemoServerState,
  type Route,
  type SlotRow,
  type WeekRow,
} from './state.ts'
import { ACCOUNT } from '../index.ts'

/**
 * Opening hours, the usual week, roster weeks from draft to published, manual
 * changes, backups, export and covering vacancies — api-vista
 * src/routes/team-roster.ts with src/team/roster-data.ts and coverage.ts.
 * The system recommends; management decides: no warning blocks anything.
 */

const ms = (iso: string) => Date.parse(iso)

export function requireWeek(state: DemoServerState, id: string): WeekRow {
  return state.weeks.find((week) => week.id === id) ?? notFound('team:WEEK_NOT_FOUND')
}

export function weekSlots(state: DemoServerState, weekId: string): SlotRow[] {
  return state.slots
    .filter((slot) => slot.weekId === weekId)
    .toSorted((a, b) => ms(a.startsAt) - ms(b.startsAt) || a.id.localeCompare(b.id))
}

function slotOf(state: DemoServerState, id: string): SlotRow | undefined {
  return state.slots.find((slot) => slot.id === id)
}

/** When someone actually works a shift: a backup's own times, otherwise the slot's. */
export function workTimes(assignment: Pick<AssignmentRow, 'startsAt' | 'endsAt'>, slot: Pick<SlotRow, 'startsAt' | 'endsAt'>) {
  return { startsAt: assignment.startsAt ?? slot.startsAt, endsAt: assignment.endsAt ?? slot.endsAt }
}

/** The places a shift fills. Backups are extra and never count. */
function activePlacements(state: DemoServerState, slots: SlotRow[]): Array<Placement & { isLocked: boolean; id: string }> {
  const ids = new Set(slots.map((slot) => slot.id))
  return state.assignments
    .filter((row) => ids.has(row.slotId) && row.status === 'ACTIVE' && !row.isBackup)
    .map((row) => ({ id: row.id, slotId: row.slotId, staffId: row.staffId, isLocked: row.isLocked }))
}

/** Everyone the engine should consider: active staff, plus anyone already placed. */
function engineStaff(state: DemoServerState, alsoInclude: string[] = []): EngineStaff[] {
  return state.staff
    .filter((staff) => staff.status === 'ACTIVE' || alsoInclude.includes(staff.id))
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .map((staff) => ({ id: staff.id, name: staff.name, roleTags: staff.roleTags, attributes: staff.attributes }))
}

function engineInputFor(state: DemoServerState, week: WeekRow): EngineInput {
  const slots = weekSlots(state, week.id)
  const placements = activePlacements(state, slots)
  return {
    staff: engineStaff(state, placements.map((placement) => placement.staffId)),
    slots: slots.map((slot) => ({
      id: slot.id,
      startsAt: ms(slot.startsAt),
      endsAt: ms(slot.endsAt),
      requiredStaff: slot.requiredStaff,
      canRunSolo: slot.canRunSolo,
      roleTags: slot.roleTags,
    })),
    applications: new Map(
      slots.map((slot) => [slot.id, new Set(state.applications.filter((row) => row.slotId === slot.id).map((row) => row.staffId))]),
    ),
    locked: placements.filter((placement) => placement.isLocked),
    limits: {
      targetShifts: week.assignmentTargetShifts,
      maxShifts: week.assignmentMaxShifts,
      maxMinutes: week.assignmentMaxMinutes,
    },
    weights: weightsFrom(state.settings.engineWeights),
  }
}

/** Bump a week's version so exports and staff screens can tell it changed. */
export function touchWeek(ctx: Pick<Ctx, 'state' | 'now'>, weekId: string): void {
  const week = requireWeek(ctx.state, weekId)
  week.version += 1
  week.updatedAt = ctx.now.toISOString()
}

/** Active and Completed are read from the clock, not stored. */
function weekPhase(week: WeekRow, now: Date): string {
  if (week.status !== 'PUBLISHED') return week.status
  const start = Date.parse(`${week.weekStart}T00:00:00Z`) - 8 * 3_600_000
  if (now.getTime() >= start + 7 * 86_400_000) return 'COMPLETED'
  if (now.getTime() >= start) return 'ACTIVE'
  return 'PUBLISHED'
}

function serialiseWeek(week: WeekRow, now: Date) {
  return {
    ...week,
    weekEnd: addDays(week.weekStart, 6),
    label: rangeLabel(week.weekStart, addDays(week.weekStart, 6)),
    phase: weekPhase(week, now),
  }
}

/** Minutes each staff member was rostered in the four weeks before this one. */
function trailingMinutes(state: DemoServerState, weekStart: string): Map<string, number> {
  const start = Date.parse(`${weekStart}T00:00:00Z`) - 8 * 3_600_000
  const totals = new Map<string, number>()
  for (const assignment of state.assignments) {
    if (assignment.status !== 'ACTIVE') continue
    const slot = slotOf(state, assignment.slotId)
    if (!slot || ms(slot.startsAt) < start - 28 * 86_400_000 || ms(slot.startsAt) >= start) continue
    totals.set(assignment.staffId, (totals.get(assignment.staffId) ?? 0) + minutesBetween(slot.startsAt, slot.endsAt))
  }
  return totals
}

const staffName = (state: DemoServerState, id: string) => state.staff.find((staff) => staff.id === id)?.name ?? ''

/** Everything the roster screen shows for one week. */
export function weekDetail(state: DemoServerState, weekId: string, now: Date) {
  const week = requireWeek(state, weekId)
  const input = engineInputFor(state, week)
  const slots = weekSlots(state, weekId)
  const { warnings, fairness } = evaluateRoster(input, activePlacements(state, slots))
  const trailing = trailingMinutes(state, week.weekStart)
  const attributes = new Map(input.staff.map((staff) => [staff.id, staff.attributes]))

  return {
    week: serialiseWeek(week, now),
    slots: slots.map((slot) => {
      const open = state.coverage.find((request) => request.slotId === slot.id && request.status === 'OPEN')
      const vacated = open?.vacatedAssignmentId ? state.assignments.find((row) => row.id === open.vacatedAssignmentId) : null
      const asking = open ? state.offers.find((offer) => offer.coverageId === open.id && offer.status === 'PENDING') : null
      return {
        id: slot.id,
        date: mytDate(slot.startsAt),
        startTime: mytTime(slot.startsAt),
        endTime: mytTime(slot.endsAt),
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        minutes: minutesBetween(slot.startsAt, slot.endsAt),
        requiredStaff: slot.requiredStaff,
        canRunSolo: slot.canRunSolo,
        roleTags: slot.roleTags,
        workTypeId: slot.workTypeId,
        label: slot.label,
        allowsBackup: slot.allowsBackup,
        applicants: state.applications
          .filter((row) => row.slotId === slot.id)
          .map((row) => ({ staffId: row.staffId, appliedAt: row.createdAt })),
        assignments: state.assignments
          .filter((row) => row.slotId === slot.id)
          .map((row) => {
            const times = workTimes(row, slot)
            return {
              id: row.id,
              staffId: row.staffId,
              staffName: staffName(state, row.staffId),
              status: row.status,
              source: row.source,
              isLocked: row.isLocked,
              workTypeId: row.workTypeId,
              rateOverrideSen: row.rateOverrideSen,
              rateOverrideReason: row.rateOverrideReason,
              explanation: row.explanation,
              isBackup: row.isBackup,
              hoursOnly: row.hoursOnly,
              startTime: mytTime(times.startsAt),
              endTime: mytTime(times.endsAt),
              minutes: minutesBetween(times.startsAt, times.endsAt),
            }
          }),
        openCoverage: open
          ? {
              id: open.id,
              isUrgent: open.isUrgent,
              vacatedBy: vacated ? staffName(state, vacated.staffId) : null,
              askingName: asking ? staffName(state, asking.staffId) : null,
            }
          : null,
      }
    }),
    staff: input.staff
      .map((member) => state.staff.find((staff) => staff.id === member.id))
      .filter((staff) => staff !== undefined)
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((staff) => ({
        id: staff.id,
        name: staff.name,
        staffCode: staff.staffCode,
        status: staff.status,
        roleTags: staff.roleTags,
        defaultWorkTypeId: staff.defaultWorkTypeId,
        soloSuitability: attributes.get(staff.id)?.soloSuitability ?? 'SUITABLE',
        trainingStatus: attributes.get(staff.id)?.trainingStatus ?? 'TRAINED',
        trailingMinutes: trailing.get(staff.id) ?? 0,
      })),
    fairness,
    warnings,
  }
}

// ---------------------------------------------------------------------------
// Coverage (src/team/coverage.ts)
// ---------------------------------------------------------------------------

/** The replacement queue for a vacancy, best first, leaving out who was asked and who left. */
function replacementQueue(state: DemoServerState, coverageId: string) {
  const request = state.coverage.find((row) => row.id === coverageId)
  const slot = request ? slotOf(state, request.slotId) : undefined
  if (!request || !slot) return []
  const week = requireWeek(state, slot.weekId)
  const input = engineInputFor(state, week)
  const exclude = new Set(state.offers.filter((offer) => offer.coverageId === coverageId).map((offer) => offer.staffId))
  const vacated = request.vacatedAssignmentId ? state.assignments.find((row) => row.id === request.vacatedAssignmentId) : null
  if (vacated) exclude.add(vacated.staffId)
  const active = new Set(state.staff.filter((staff) => staff.status === 'ACTIVE').map((staff) => staff.id))
  const slotIds = new Set(weekSlots(state, week.id).map((row) => row.id))
  const placements = state.assignments
    .filter((row) => slotIds.has(row.slotId) && row.status === 'ACTIVE')
    .map((row) => ({ slotId: row.slotId, staffId: row.staffId }))
  return rankReplacements({ ...input, staff: input.staff.filter((staff) => active.has(staff.id)) }, placements, slot.id, exclude)
}

/** Offer the vacancy to the next person in the queue, unless an offer is already waiting. */
function offerNext(ctx: Pick<Ctx, 'state' | 'now'>, coverageId: string): string | null {
  const { state, now } = ctx
  const request = state.coverage.find((row) => row.id === coverageId) ?? notFound('team:COVERAGE_NOT_FOUND')
  if (request.status !== 'OPEN') return null
  const offers = state.offers.filter((offer) => offer.coverageId === coverageId)
  if (offers.some((offer) => offer.status === 'PENDING')) return null
  const slot = slotOf(state, request.slotId)
  // A shift that has already started is management's to sort out by hand.
  if (!slot || ms(slot.startsAt) <= now.getTime()) return null
  const next = replacementQueue(state, coverageId)[0]
  if (!next) return null
  const offer = { id: newId(state), coverageId, staffId: next.staffId, rank: offers.length + 1, status: 'PENDING' as const, respondedAt: null }
  state.offers.push(offer)
  audit(ctx, SYSTEM, { action: 'coverage.offered', entityType: 'coverage', entityId: coverageId, after: { offerId: offer.id, staffId: next.staffId, rank: offer.rank } })
  return offer.id
}

export function openCoverage(ctx: Pick<Ctx, 'state' | 'now'>, actor: Actor, slotId: string, vacatedAssignmentId: string | null): string {
  const { state, now } = ctx
  const slot = slotOf(state, slotId) ?? notFound('team:SHIFT_NOT_FOUND')
  const isUrgent = ms(slot.startsAt) - now.getTime() <= state.settings.urgentCoverageHours * 3_600_000
  const request = { id: newId(state), slotId, vacatedAssignmentId, isUrgent, status: 'OPEN' as const, createdAt: now.toISOString(), resolvedAt: null }
  state.coverage.push(request)
  audit(ctx, actor, {
    action: isUrgent ? 'coverage.opened_urgent' : 'coverage.opened',
    entityType: 'coverage',
    entityId: request.id,
    after: { slotId, vacatedAssignmentId, isUrgent },
  })
  offerNext(ctx, request.id)
  return request.id
}

/** Put someone on the vacated seat and close the vacancy; other waiting offers are superseded. */
function fillCoverage(ctx: Pick<Ctx, 'state' | 'now'>, actor: Actor, coverageId: string, staffId: string): string {
  const { state, now } = ctx
  const request = state.coverage.find((row) => row.id === coverageId) ?? notFound('team:COVERAGE_NOT_FOUND')
  if (request.status !== 'OPEN') conflict('team:COVERAGE_CLOSED')
  const assignment = newAssignment(state, now, request.slotId, staffId, 'REPLACEMENT')
  request.status = 'FILLED'
  request.resolvedAt = now.toISOString()
  const offers = state.offers.filter((offer) => offer.coverageId === coverageId)
  const own = offers.find((offer) => offer.staffId === staffId)
  if (own) {
    own.status = 'MANAGER_CONFIRMED'
    own.respondedAt = now.toISOString()
  } else {
    state.offers.push({ id: newId(state), coverageId, staffId, rank: offers.length + 1, status: 'MANAGER_CONFIRMED', respondedAt: now.toISOString() })
  }
  for (const offer of offers) {
    if (offer.status === 'PENDING' && offer.staffId !== staffId) {
      offer.status = 'SUPERSEDED'
      offer.respondedAt = now.toISOString()
    }
  }
  const slot = slotOf(state, request.slotId)
  if (slot) touchWeek(ctx, slot.weekId)
  audit(ctx, actor, { action: 'coverage.confirmed_by_manager', entityType: 'coverage', entityId: coverageId, after: { staffId, assignmentId: assignment.id } })
  return assignment.id
}

function newAssignment(
  state: DemoServerState,
  now: Date,
  slotId: string,
  staffId: string,
  source: AssignmentRow['source'],
  extra: Partial<AssignmentRow> = {},
): AssignmentRow {
  const row: AssignmentRow = {
    id: newId(state),
    slotId,
    staffId,
    status: 'ACTIVE',
    source,
    isLocked: false,
    workTypeId: null,
    rateOverrideSen: null,
    rateOverrideReason: null,
    explanation: null,
    isBackup: false,
    hoursOnly: false,
    startsAt: null,
    endsAt: null,
    createdAt: now.toISOString(),
    endedAt: null,
    ...extra,
  }
  state.assignments.push(row)
  return row
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function assertWorkType(state: DemoServerState, id: unknown): void {
  if (id && !state.workTypes.some((type) => type.id === id)) badRequest('team:WORK_TYPE_NOT_FOUND')
}

function time(value: unknown): string {
  return typeof value === 'string' && HHMM.test(value) ? value : badRequest('demo:INVALID')
}

function date(value: unknown): string {
  return typeof value === 'string' && ISO_DATE.test(value) ? value : badRequest('demo:INVALID')
}

const hasAttendance = (state: DemoServerState, slotIds: Set<string>) =>
  state.attendance.some((row) => {
    const assignment = row.assignmentId ? state.assignments.find((candidate) => candidate.id === row.assignmentId) : null
    return assignment ? slotIds.has(assignment.slotId) : false
  })

/** Slot times for a date inside a week. */
function slotTimes(weekStart: string, body: { date: string; startTime: string; endTime: string }) {
  const offset = Math.round((Date.parse(`${body.date}T00:00:00Z`) - Date.parse(`${weekStart}T00:00:00Z`)) / 86_400_000)
  if (offset < 0 || offset > 6) badRequest('team:DATE_OUTSIDE_WEEK')
  const { startsAt, endsAt } = shiftInstants(body.date, body.startTime, body.endTime)
  return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }
}

function removeSlots(state: DemoServerState, ids: Set<string>): void {
  const coverageIds = new Set(state.coverage.filter((row) => ids.has(row.slotId)).map((row) => row.id))
  state.offers = state.offers.filter((offer) => !coverageIds.has(offer.coverageId))
  state.coverage = state.coverage.filter((row) => !ids.has(row.slotId))
  state.applications = state.applications.filter((row) => !ids.has(row.slotId))
  state.assignments = state.assignments.filter((row) => !ids.has(row.slotId))
  state.slots = state.slots.filter((slot) => !ids.has(slot.id))
}

function scheduleSetup({ state }: Ctx) {
  return {
    operatingHours: state.hours.toSorted((a, b) => a.weekday - b.weekday),
    closedPeriods: state.closed.toSorted((a, b) => a.startDate.localeCompare(b.startDate)),
    templates: state.templates.toSorted((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime)),
  }
}

function saveHours(ctx: Ctx) {
  const days = ctx.body.days
  if (!Array.isArray(days)) return badRequest('demo:INVALID')
  for (const day of days as Array<{ weekday: number; isClosed: boolean; opensAt: string; closesAt: string }>) {
    const next = { weekday: day.weekday, isClosed: Boolean(day.isClosed), opensAt: time(day.opensAt), closesAt: time(day.closesAt) }
    ctx.state.hours = [...ctx.state.hours.filter((row) => row.weekday !== day.weekday), next]
  }
  audit(ctx, MANAGEMENT, { action: 'schedule.hours_changed', entityType: 'schedule', after: days })
  return { ok: true }
}

function addClosed(ctx: Ctx) {
  const startDate = date(ctx.body.startDate)
  const endDate = date(ctx.body.endDate)
  if (endDate < startDate) badRequest('team:RANGE_BACKWARDS')
  const period = { id: newId(ctx.state), startDate, endDate, reason: optStr(ctx.body, 'reason') ?? null }
  ctx.state.closed.push(period)
  audit(ctx, MANAGEMENT, { action: 'schedule.closed_period_added', entityType: 'schedule', entityId: period.id, after: ctx.body })
  return { id: period.id }
}

function removeClosed(ctx: Ctx) {
  const id = ctx.params.id ?? ''
  if (!ctx.state.closed.some((period) => period.id === id)) notFound('team:NOT_FOUND')
  ctx.state.closed = ctx.state.closed.filter((period) => period.id !== id)
  audit(ctx, MANAGEMENT, { action: 'schedule.closed_period_removed', entityType: 'schedule', entityId: id })
  return { ok: true }
}

/** Replace the usual week's shifts. Existing roster weeks are not touched. */
function saveTemplates(ctx: Ctx) {
  const templates = ctx.body.templates
  if (!Array.isArray(templates)) return badRequest('demo:INVALID')
  for (const template of templates as SlotTemplate[]) assertWorkType(ctx.state, template.workTypeId)
  ctx.state.templates = (templates as SlotTemplate[]).map((template) => ({
    id: newId(ctx.state),
    weekday: template.weekday,
    startTime: time(template.startTime),
    endTime: time(template.endTime),
    requiredStaff: template.requiredStaff ?? 1,
    canRunSolo: template.canRunSolo ?? true,
    roleTags: template.roleTags ?? [],
    workTypeId: template.workTypeId ?? null,
    label: template.label ?? null,
  }))
  audit(ctx, MANAGEMENT, { action: 'schedule.templates_changed', entityType: 'schedule', after: templates })
  return { ok: true }
}

function listWeeks({ state, now }: Ctx) {
  return {
    weeks: state.weeks
      .toSorted((a, b) => b.weekStart.localeCompare(a.weekStart))
      .slice(0, 26)
      .map((week) => {
        const slots = weekSlots(state, week.id)
        const seats = slots.reduce((sum, slot) => sum + slot.requiredStaff, 0)
        const filled = slots.reduce(
          (sum, slot) =>
            sum +
            Math.min(
              slot.requiredStaff,
              state.assignments.filter((row) => row.slotId === slot.id && row.status === 'ACTIVE' && !row.isBackup).length,
            ),
          0,
        )
        const ids = new Set(slots.map((slot) => slot.id))
        const applicants = new Set(state.applications.filter((row) => ids.has(row.slotId)).map((row) => row.staffId))
        return { ...serialiseWeek(week, now), shiftCount: slots.length, seats, filled, applicantCount: applicants.size }
      }),
  }
}

/**
 * Start a week: limits from the team settings, shifts copied from an earlier
 * week or from the usual week (skipping closed weekdays and closed dates).
 */
export function createWeek(ctx: Ctx) {
  const { state, body, now } = ctx
  const weekStart = date(body.weekStart)
  if (weekdayOf(weekStart) !== 0) badRequest('team:WEEK_NOT_MONDAY')
  if (state.weeks.some((week) => week.weekStart === weekStart)) conflict('team:WEEK_EXISTS')
  const { settings } = state
  const instant = (key: string) => (typeof body[key] === 'string' ? (body[key] as string) : null)
  const week: WeekRow = {
    id: newId(state),
    weekStart,
    status: 'DRAFT',
    applicationsOpenAt: instant('applicationsOpenAt'),
    applicationsCloseAt: instant('applicationsCloseAt'),
    reviewDeadline: instant('reviewDeadline'),
    publishDeadline: instant('publishDeadline'),
    applicationLimit: settings.applicationLimit,
    assignmentTargetShifts: settings.assignmentTargetShifts,
    assignmentMaxShifts: settings.assignmentMaxShifts,
    assignmentMaxMinutes: settings.assignmentMaxMinutes,
    withdrawalDeadlineHours: settings.withdrawalDeadlineHours,
    generatedAt: null,
    reviewedAt: null,
    publishedAt: null,
    updatedAt: now.toISOString(),
    version: 1,
  }
  state.weeks.push(week)

  let created = 0
  const copyFrom = typeof body.copyFromWeekId === 'string' ? body.copyFromWeekId : null
  if (copyFrom) {
    const source = requireWeek(state, copyFrom)
    const shiftMs = Date.parse(`${weekStart}T00:00:00Z`) - Date.parse(`${source.weekStart}T00:00:00Z`)
    for (const slot of weekSlots(state, source.id)) {
      state.slots.push({
        ...slot,
        id: newId(state),
        weekId: week.id,
        startsAt: new Date(ms(slot.startsAt) + shiftMs).toISOString(),
        endsAt: new Date(ms(slot.endsAt) + shiftMs).toISOString(),
      })
      created += 1
    }
  } else if (body.fromTemplate !== false) {
    const closedWeekdays = new Set(state.hours.filter((day) => day.isClosed).map((day) => day.weekday))
    for (const template of state.templates) {
      const day = addDays(weekStart, template.weekday)
      if (closedWeekdays.has(weekdayOf(day))) continue
      if (state.closed.some((period) => period.startDate <= day && day <= period.endDate)) continue
      const { startsAt, endsAt } = shiftInstants(day, template.startTime, template.endTime)
      state.slots.push({
        id: newId(state),
        weekId: week.id,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        requiredStaff: template.requiredStaff,
        canRunSolo: template.canRunSolo,
        roleTags: template.roleTags,
        workTypeId: template.workTypeId,
        label: template.label,
        allowsBackup: false,
      })
      created += 1
    }
  }
  audit(ctx, MANAGEMENT, {
    action: 'roster.week_created',
    entityType: 'roster_week',
    entityId: week.id,
    after: { weekStart, copiedFromWeekId: copyFrom, shifts: created },
  })
  return weekDetail(state, week.id, now)
}

function updateWeek(ctx: Ctx) {
  const { state, body, now } = ctx
  const week = requireWeek(state, ctx.params.id ?? '')
  const before = serialiseWeek({ ...week }, now)
  const target = has(body, 'assignmentTargetShifts') ? (body.assignmentTargetShifts as number) : week.assignmentTargetShifts
  const max = has(body, 'assignmentMaxShifts') ? (body.assignmentMaxShifts as number) : week.assignmentMaxShifts
  if (max < target) badRequest('team:TARGET_ABOVE_MAX')
  const keys = [
    'applicationsOpenAt',
    'applicationsCloseAt',
    'reviewDeadline',
    'publishDeadline',
    'applicationLimit',
    'assignmentTargetShifts',
    'assignmentMaxShifts',
    'assignmentMaxMinutes',
    'withdrawalDeadlineHours',
  ] as const
  for (const key of keys) if (has(body, key)) (week as Record<string, unknown>)[key] = body[key]
  week.updatedAt = now.toISOString()
  audit(ctx, MANAGEMENT, { action: 'roster.week_settings_changed', entityType: 'roster_week', entityId: week.id, before, after: serialiseWeek(week, now) })
  return weekDetail(state, week.id, now)
}

/** Move a week through its stages. Publishing has its own route. */
export function setStatus(ctx: Ctx) {
  const { state, body, now } = ctx
  const week = requireWeek(state, ctx.params.id ?? '')
  const status = body.status
  if (status !== 'DRAFT' && status !== 'APPLICATIONS_OPEN' && status !== 'APPLICATIONS_CLOSED' && status !== 'IN_REVIEW') {
    return badRequest('demo:INVALID')
  }
  const before = week.status
  week.status = status
  if (status === 'IN_REVIEW') week.reviewedAt = now.toISOString()
  week.updatedAt = now.toISOString()
  audit(ctx, MANAGEMENT, {
    action: before === 'PUBLISHED' ? 'roster.unpublished' : 'roster.status_changed',
    entityType: 'roster_week',
    entityId: week.id,
    before: { status: before },
    after: { status },
  })
  return weekDetail(state, week.id, now)
}

/**
 * The engine's suggestion. Locked assignments stay; every other one is
 * replaced. Refused on a published week.
 */
export function generate(ctx: Ctx) {
  const { state, now } = ctx
  const week = requireWeek(state, ctx.params.id ?? '')
  if (week.status === 'PUBLISHED') conflict('team:WEEK_PUBLISHED')
  const slotIds = new Set(weekSlots(state, week.id).map((slot) => slot.id))
  const replaced = state.assignments.filter((row) => slotIds.has(row.slotId) && row.status === 'ACTIVE' && !row.isLocked)
  const attended = new Set(state.attendance.map((row) => row.assignmentId))
  for (const row of replaced) {
    if (attended.has(row.id)) {
      row.status = 'REMOVED'
      row.endedAt = now.toISOString()
    }
  }
  state.assignments = state.assignments.filter((row) => !replaced.includes(row) || attended.has(row.id))

  const input = engineInputFor(state, week)
  const active = new Set(state.staff.filter((staff) => staff.status === 'ACTIVE').map((staff) => staff.id))
  const result = generateRoster({ ...input, staff: input.staff.filter((staff) => active.has(staff.id)) })
  for (const suggestion of result.assignments) {
    newAssignment(state, now, suggestion.slotId, suggestion.staffId, 'AUTO', { explanation: suggestion.explanation })
  }
  week.status = 'GENERATED'
  week.generatedAt = now.toISOString()
  touchWeek(ctx, week.id)
  audit(ctx, MANAGEMENT, {
    action: 'roster.generated',
    entityType: 'roster_week',
    entityId: week.id,
    before: { replaced: replaced.map(({ slotId, staffId }) => ({ slotId, staffId })) },
    after: { assignments: result.assignments.map(({ slotId, staffId }) => ({ slotId, staffId })), locked: input.locked.length },
  })
  return weekDetail(state, week.id, now)
}

/** Staff see their shifts from now on. The roster can still be changed. */
export function publish(ctx: Ctx) {
  const { state, now } = ctx
  const week = requireWeek(state, ctx.params.id ?? '')
  if (week.status === 'PUBLISHED') return weekDetail(state, week.id, now)
  const placements = activePlacements(state, weekSlots(state, week.id))
  const { warnings } = evaluateRoster(engineInputFor(state, week), placements)
  week.status = 'PUBLISHED'
  week.publishedAt = now.toISOString()
  week.reviewedAt = week.reviewedAt ?? now.toISOString()
  touchWeek(ctx, week.id)
  audit(ctx, MANAGEMENT, {
    action: 'roster.published',
    entityType: 'roster_week',
    entityId: week.id,
    after: { assignments: placements.length, warningsAtPublish: warnings.length },
  })
  return weekDetail(state, week.id, now)
}

/**
 * Give each shift to its applicants until it is full: most shifts offered
 * first, then whoever applied first. Nobody is put on two overlapping shifts.
 */
export function fillFromPicks(ctx: Ctx) {
  const { state, now } = ctx
  const week = requireWeek(state, ctx.params.id ?? '')
  if (week.status === 'PUBLISHED') conflict('team:WEEK_PUBLISHED')
  const active = new Set(state.staff.filter((staff) => staff.status === 'ACTIVE').map((staff) => staff.id))
  const slots = weekSlots(state, week.id)
  const placed = slots.flatMap((slot) =>
    state.assignments
      .filter((row) => row.slotId === slot.id && row.status === 'ACTIVE')
      .map((row) => {
        const times = workTimes(row, slot)
        return { staffId: row.staffId, startsAt: ms(times.startsAt), endsAt: ms(times.endsAt) }
      }),
  )
  const slotIds = new Set(slots.map((slot) => slot.id))
  const offered = new Map<string, number>()
  for (const application of state.applications.filter((row) => slotIds.has(row.slotId))) {
    offered.set(application.staffId, (offered.get(application.staffId) ?? 0) + 1)
  }
  const added: Array<{ slotId: string; staffId: string }> = []
  let leftOver = 0
  for (const slot of slots) {
    const onSlot = () => state.assignments.filter((row) => row.slotId === slot.id && row.status === 'ACTIVE')
    let open = slot.requiredStaff - onSlot().filter((row) => !row.isBackup).length
    const picks = state.applications
      .filter((row) => row.slotId === slot.id)
      .toSorted((a, b) => (offered.get(b.staffId) ?? 0) - (offered.get(a.staffId) ?? 0) || ms(a.createdAt) - ms(b.createdAt))
    for (const pick of picks) {
      if (onSlot().some((row) => row.staffId === pick.staffId)) continue
      const busy = placed.some((p) => p.staffId === pick.staffId && p.startsAt < ms(slot.endsAt) && p.endsAt > ms(slot.startsAt))
      if (open <= 0 || busy || !active.has(pick.staffId)) {
        leftOver += 1
        continue
      }
      newAssignment(state, now, slot.id, pick.staffId, 'MANUAL')
      placed.push({ staffId: pick.staffId, startsAt: ms(slot.startsAt), endsAt: ms(slot.endsAt) })
      added.push({ slotId: slot.id, staffId: pick.staffId })
      open -= 1
    }
  }
  if (added.length > 0) touchWeek(ctx, week.id)
  audit(ctx, MANAGEMENT, { action: 'roster.filled_from_picks', entityType: 'roster_week', entityId: week.id, after: { added, leftOver } })
  return { added: added.length, leftOver, detail: weekDetail(state, week.id, now) }
}

function deleteWeek(ctx: Ctx) {
  const { state, now } = ctx
  const week = requireWeek(state, ctx.params.id ?? '')
  if (week.status === 'PUBLISHED') conflict('team:WEEK_PUBLISHED')
  const slotIds = new Set(weekSlots(state, week.id).map((slot) => slot.id))
  if (hasAttendance(state, slotIds)) conflict('team:HAS_ATTENDANCE')
  removeSlots(state, slotIds)
  state.weeks = state.weeks.filter((row) => row.id !== week.id)
  audit(ctx, MANAGEMENT, { action: 'roster.week_deleted', entityType: 'roster_week', entityId: week.id, before: serialiseWeek(week, now) })
  return { ok: true }
}

/** Days, times and names only: what may be shared. */
function exportWeek({ state, params }: Ctx) {
  const week = requireWeek(state, params.id ?? '')
  const slots = weekSlots(state, week.id)
  const days = Array.from({ length: 7 }, (_, index) => addDays(week.weekStart, index)).map((day) => ({
    date: day,
    label: new Intl.DateTimeFormat('en-MY', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
      new Date(`${day}T00:00:00Z`),
    ),
    shifts: slots
      .filter((slot) => mytDate(slot.startsAt) === day)
      .map((slot) => ({
        startTime: mytTime(slot.startsAt),
        endTime: mytTime(slot.endsAt),
        label: slot.label,
        staff: state.assignments
          .filter((row) => row.slotId === slot.id && row.status === 'ACTIVE')
          .map((row) => (row.isBackup ? `${staffName(state, row.staffId)} (backup)` : staffName(state, row.staffId))),
      })),
  }))
  return {
    businessName: ACCOUNT.businessName,
    weekStart: week.weekStart,
    weekEnd: addDays(week.weekStart, 6),
    label: rangeLabel(week.weekStart, addDays(week.weekStart, 6)),
    isPublished: week.status === 'PUBLISHED',
    updatedAt: week.updatedAt,
    days,
  }
}

function addSlot(ctx: Ctx) {
  const { state, body, now } = ctx
  const week = requireWeek(state, ctx.params.id ?? '')
  assertWorkType(state, body.workTypeId)
  const times = slotTimes(week.weekStart, { date: date(body.date), startTime: time(body.startTime), endTime: time(body.endTime) })
  const slot: SlotRow = {
    id: newId(state),
    weekId: week.id,
    ...times,
    requiredStaff: typeof body.requiredStaff === 'number' ? body.requiredStaff : 1,
    canRunSolo: body.canRunSolo !== false,
    roleTags: Array.isArray(body.roleTags) ? (body.roleTags as string[]) : [],
    workTypeId: (body.workTypeId as string | null | undefined) ?? null,
    label: optStr(body, 'label') ?? null,
    allowsBackup: body.allowsBackup === true,
  }
  state.slots.push(slot)
  touchWeek(ctx, week.id)
  audit(ctx, MANAGEMENT, { action: 'roster.shift_added', entityType: 'shift', entityId: slot.id, after: body })
  return weekDetail(state, week.id, now)
}

function updateSlot(ctx: Ctx) {
  const { state, body, now } = ctx
  const slot = slotOf(state, ctx.params.id ?? '') ?? notFound('team:SHIFT_NOT_FOUND')
  const week = requireWeek(state, slot.weekId)
  assertWorkType(state, body.workTypeId)
  const before = { startsAt: slot.startsAt, endsAt: slot.endsAt, requiredStaff: slot.requiredStaff }
  if (has(body, 'date') || has(body, 'startTime') || has(body, 'endTime')) {
    Object.assign(
      slot,
      slotTimes(week.weekStart, {
        date: has(body, 'date') ? date(body.date) : mytDate(slot.startsAt),
        startTime: has(body, 'startTime') ? time(body.startTime) : mytTime(slot.startsAt),
        endTime: has(body, 'endTime') ? time(body.endTime) : mytTime(slot.endsAt),
      }),
    )
  }
  if (has(body, 'requiredStaff')) slot.requiredStaff = body.requiredStaff as number
  if (has(body, 'canRunSolo')) slot.canRunSolo = Boolean(body.canRunSolo)
  if (has(body, 'roleTags')) slot.roleTags = body.roleTags as string[]
  if (has(body, 'workTypeId')) slot.workTypeId = (body.workTypeId as string | null) ?? null
  if (has(body, 'label')) slot.label = optStr(body, 'label') ?? null
  if (has(body, 'allowsBackup')) slot.allowsBackup = Boolean(body.allowsBackup)
  touchWeek(ctx, week.id)
  audit(ctx, MANAGEMENT, {
    action: 'roster.shift_changed',
    entityType: 'shift',
    entityId: slot.id,
    before,
    after: { startsAt: slot.startsAt, endsAt: slot.endsAt, requiredStaff: slot.requiredStaff },
  })
  return weekDetail(state, week.id, now)
}

function removeSlot(ctx: Ctx) {
  const { state, now } = ctx
  const slot = slotOf(state, ctx.params.id ?? '') ?? notFound('team:SHIFT_NOT_FOUND')
  if (hasAttendance(state, new Set([slot.id]))) conflict('team:HAS_ATTENDANCE')
  removeSlots(state, new Set([slot.id]))
  touchWeek(ctx, slot.weekId)
  audit(ctx, MANAGEMENT, { action: 'roster.shift_removed', entityType: 'shift', entityId: slot.id, before: { startsAt: slot.startsAt, endsAt: slot.endsAt } })
  return weekDetail(state, slot.weekId, now)
}

/** Make one day's shifts copies of another day's (not the people). */
function copyDay(ctx: Ctx) {
  const { state, now } = ctx
  const week = requireWeek(state, ctx.params.id ?? '')
  const target = date(ctx.params.date)
  const fromDate = date(ctx.body.fromDate)
  const inWeek = (value: string) => value >= week.weekStart && value <= addDays(week.weekStart, 6)
  if (!inWeek(target) || !inWeek(fromDate)) badRequest('team:DATE_OUTSIDE_WEEK')
  if (target === fromDate) return weekDetail(state, week.id, now)
  const slots = weekSlots(state, week.id)
  const targets = new Set(slots.filter((slot) => mytDate(slot.startsAt) === target).map((slot) => slot.id))
  if (hasAttendance(state, targets)) conflict('team:HAS_ATTENDANCE')
  removeSlots(state, targets)
  const dayMs = Date.parse(`${target}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)
  const sources = slots.filter((slot) => mytDate(slot.startsAt) === fromDate)
  for (const slot of sources) {
    state.slots.push({
      ...slot,
      id: newId(state),
      startsAt: new Date(ms(slot.startsAt) + dayMs).toISOString(),
      endsAt: new Date(ms(slot.endsAt) + dayMs).toISOString(),
    })
  }
  touchWeek(ctx, week.id)
  audit(ctx, MANAGEMENT, {
    action: 'roster.day_copied',
    entityType: 'roster_week',
    entityId: week.id,
    after: { fromDate, toDate: target, replaced: targets.size, copied: sources.length },
  })
  return weekDetail(state, week.id, now)
}

/**
 * Put someone on a shift. Warnings come back for the screen; none stops it.
 * On a shift with an open vacancy, this fills it as a manager confirmation.
 */
export function assign(ctx: Ctx) {
  const { state, body, now } = ctx
  const slot = slotOf(state, ctx.params.id ?? '') ?? notFound('team:SHIFT_NOT_FOUND')
  const staffId = typeof body.staffId === 'string' ? body.staffId : ''
  const staff = state.staff.find((row) => row.id === staffId) ?? notFound('team:STAFF_NOT_FOUND')
  if (staff.status !== 'ACTIVE') conflict('team:STAFF_INACTIVE')
  assertWorkType(state, body.workTypeId)
  if (state.assignments.some((row) => row.slotId === slot.id && row.staffId === staffId && row.status === 'ACTIVE')) {
    conflict('team:ALREADY_ASSIGNED')
  }
  const week = requireWeek(state, slot.weekId)
  const input = engineInputFor(state, week)
  const withStaff = input.staff.some((member) => member.id === staffId)
    ? input
    : { ...input, staff: [...input.staff, ...engineStaff(state, [staffId]).filter((member) => member.id === staffId)] }
  const warnings = warningsForPlacement(withStaff, activePlacements(state, weekSlots(state, week.id)), { slotId: slot.id, staffId })
  const isLocked = body.isLocked === true
  const workTypeId = (body.workTypeId as string | null | undefined) ?? null

  const vacancy = state.coverage.find((row) => row.slotId === slot.id && row.status === 'OPEN')
  let assignmentId: string
  if (vacancy) {
    assignmentId = fillCoverage(ctx, MANAGEMENT, vacancy.id, staffId)
    const row = state.assignments.find((candidate) => candidate.id === assignmentId)
    if (row && (isLocked || workTypeId)) Object.assign(row, { isLocked, workTypeId })
  } else {
    assignmentId = newAssignment(state, now, slot.id, staffId, 'MANUAL', { isLocked, workTypeId }).id
    touchWeek(ctx, week.id)
  }
  audit(ctx, MANAGEMENT, {
    action: warnings.length > 0 ? 'roster.assigned_over_warning' : 'roster.assigned',
    entityType: 'assignment',
    entityId: assignmentId,
    after: { slotId: slot.id, staffId, isLocked, warnings: warnings.map((warning) => warning.message) },
  })
  return { assignmentId, warnings, detail: weekDetail(state, week.id, now) }
}

/** Lock, change the work type, or set a one-off rate for this shift only. */
function updateAssignment(ctx: Ctx) {
  const { state, body, now } = ctx
  const row = state.assignments.find((candidate) => candidate.id === ctx.params.id) ?? notFound('team:ASSIGNMENT_NOT_FOUND')
  const slot = slotOf(state, row.slotId) ?? notFound('team:SHIFT_NOT_FOUND')
  assertWorkType(state, body.workTypeId)
  const before = { ...row }
  const rateChanged = has(body, 'rateOverrideSen') && body.rateOverrideSen !== row.rateOverrideSen
  if (has(body, 'isLocked')) row.isLocked = Boolean(body.isLocked)
  if (has(body, 'workTypeId')) row.workTypeId = (body.workTypeId as string | null) ?? null
  if (has(body, 'rateOverrideSen')) row.rateOverrideSen = (body.rateOverrideSen as number | null) ?? null
  if (has(body, 'rateOverrideReason')) row.rateOverrideReason = optStr(body, 'rateOverrideReason') ?? null
  if (row.rateOverrideSen === null) row.rateOverrideReason = null
  touchWeek(ctx, slot.weekId)
  if (rateChanged) {
    const staff = state.staff.find((candidate) => candidate.id === row.staffId)
    const usual = state.workTypes.find((type) => type.id === (before.workTypeId ?? staff?.defaultWorkTypeId))
    audit(ctx, MANAGEMENT, {
      action: 'pay.rate_overridden',
      entityType: 'assignment',
      entityId: row.id,
      before: { rateOverrideSen: before.rateOverrideSen, defaultRateSen: usual?.rateSenPerHour ?? null },
      after: { rateOverrideSen: row.rateOverrideSen, reason: row.rateOverrideReason },
    })
  }
  if (has(body, 'isLocked') && row.isLocked !== before.isLocked) {
    audit(ctx, MANAGEMENT, { action: row.isLocked ? 'roster.locked' : 'roster.unlocked', entityType: 'assignment', entityId: row.id })
  }
  if (has(body, 'workTypeId') && row.workTypeId !== before.workTypeId) {
    audit(ctx, MANAGEMENT, {
      action: 'roster.work_type_changed',
      entityType: 'assignment',
      entityId: row.id,
      before: { workTypeId: before.workTypeId },
      after: { workTypeId: row.workTypeId },
    })
  }
  return weekDetail(state, slot.weekId, now)
}

/**
 * Take someone off a shift. On a published shift still to come, the seat
 * becomes a vacancy and the replacement queue starts (unless vacancy=false).
 */
export function unassign(ctx: Ctx) {
  const { state, now } = ctx
  const row = state.assignments.find((candidate) => candidate.id === ctx.params.id)
  if (!row || row.status !== 'ACTIVE') return notFound('team:ASSIGNMENT_NOT_FOUND')
  const slot = slotOf(state, row.slotId) ?? notFound('team:SHIFT_NOT_FOUND')
  const published = requireWeek(state, slot.weekId).status === 'PUBLISHED'
  if (!published && !state.attendance.some((record) => record.assignmentId === row.id)) {
    state.assignments = state.assignments.filter((candidate) => candidate.id !== row.id)
  } else {
    row.status = 'REMOVED'
    row.endedAt = now.toISOString()
  }
  touchWeek(ctx, slot.weekId)
  audit(ctx, MANAGEMENT, { action: 'roster.manager_removed', entityType: 'assignment', entityId: row.id, before: { slotId: slot.id, staffId: row.staffId } })
  if (published && ctx.query.get('vacancy') !== 'false' && !row.isBackup && ms(slot.startsAt) > now.getTime()) {
    openCoverage(ctx, MANAGEMENT, slot.id, row.id)
  }
  return weekDetail(state, slot.weekId, now)
}

/** A backup's time: their own start and end, just hours from the shift's start, or the shift's own. */
function backupInstants(slot: SlotRow, body: Record<string, unknown>) {
  if (typeof body.minutes === 'number') {
    if (body.minutes < 15 || body.minutes > 16 * 60) badRequest('demo:INVALID')
    return { startsAt: slot.startsAt, endsAt: new Date(ms(slot.startsAt) + body.minutes * 60_000).toISOString(), hoursOnly: true }
  }
  if (has(body, 'startTime')) {
    const { startsAt, endsAt } = shiftInstants(mytDate(slot.startsAt), time(body.startTime), time(body.endTime))
    if (endsAt.getTime() - startsAt.getTime() > 16 * 3_600_000) badRequest('team:BACKUP_TOO_LONG')
    return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), hoursOnly: false }
  }
  return { startsAt: null, endsAt: null, hoursOnly: false }
}

function addBackup(ctx: Ctx) {
  const { state, body, now } = ctx
  const slot = slotOf(state, ctx.params.id ?? '') ?? notFound('team:SHIFT_NOT_FOUND')
  if (!slot.allowsBackup) conflict('team:BACKUP_NOT_ALLOWED')
  const staffId = typeof body.staffId === 'string' ? body.staffId : ''
  const staff = state.staff.find((row) => row.id === staffId) ?? notFound('team:STAFF_NOT_FOUND')
  if (staff.status !== 'ACTIVE') conflict('team:STAFF_INACTIVE')
  if (state.assignments.some((row) => row.slotId === slot.id && row.staffId === staffId && row.status === 'ACTIVE')) {
    conflict('team:ALREADY_ASSIGNED')
  }
  const times = backupInstants(slot, body)
  const row = newAssignment(state, now, slot.id, staffId, 'MANUAL', { isBackup: true, ...times })
  touchWeek(ctx, slot.weekId)
  audit(ctx, MANAGEMENT, { action: 'roster.backup_added', entityType: 'assignment', entityId: row.id, after: { slotId: slot.id, staffId, ...times } })
  return weekDetail(state, slot.weekId, now)
}

function setBackupTime(ctx: Ctx) {
  const { state, now } = ctx
  const row = state.assignments.find((candidate) => candidate.id === ctx.params.id)
  if (!row || row.status !== 'ACTIVE') return notFound('team:ASSIGNMENT_NOT_FOUND')
  if (!row.isBackup) conflict('team:NOT_A_BACKUP')
  const slot = slotOf(state, row.slotId) ?? notFound('team:SHIFT_NOT_FOUND')
  const before = { startsAt: row.startsAt, endsAt: row.endsAt, hoursOnly: row.hoursOnly }
  const times = backupInstants(slot, ctx.body)
  Object.assign(row, times)
  touchWeek(ctx, slot.weekId)
  audit(ctx, MANAGEMENT, { action: 'roster.backup_time_changed', entityType: 'assignment', entityId: row.id, before, after: times })
  return weekDetail(state, slot.weekId, now)
}

function listCoverage({ state, now }: Ctx) {
  const urgentMs = state.settings.urgentCoverageHours * 3_600_000
  const rank = { OPEN: 0, FILLED: 1, CANCELLED: 2 }
  const requests = state.coverage
    .filter((row) => row.status === 'OPEN' || (row.resolvedAt && ms(row.resolvedAt) >= now.getTime() - 7 * 86_400_000))
    .toSorted((a, b) => rank[a.status] - rank[b.status] || Number(b.isUrgent) - Number(a.isUrgent) || ms(a.createdAt) - ms(b.createdAt))
  return {
    coverage: requests.flatMap((item) => {
      const slot = slotOf(state, item.slotId)
      if (!slot) return []
      const vacated = item.vacatedAssignmentId ? state.assignments.find((row) => row.id === item.vacatedAssignmentId) : null
      const queue = item.status === 'OPEN' ? replacementQueue(state, item.id) : []
      return [
        {
          id: item.id,
          status: item.status,
          isUrgent: item.isUrgent || (item.status === 'OPEN' && ms(slot.startsAt) - now.getTime() <= urgentMs),
          createdAt: item.createdAt,
          resolvedAt: item.resolvedAt,
          slot: {
            id: slot.id,
            weekId: slot.weekId,
            date: mytDate(slot.startsAt),
            startTime: mytTime(slot.startsAt),
            endTime: mytTime(slot.endsAt),
            startsAt: slot.startsAt,
            label: slot.label,
          },
          vacatedBy: vacated ? staffName(state, vacated.staffId) : null,
          vacatedHow: vacated?.status ?? null,
          offers: state.offers
            .filter((offer) => offer.coverageId === item.id)
            .toSorted((a, b) => a.rank - b.rank)
            .map((offer) => ({
              id: offer.id,
              staffId: offer.staffId,
              staffName: staffName(state, offer.staffId),
              rank: offer.rank,
              status: offer.status,
              respondedAt: offer.respondedAt,
            })),
          queue: queue.slice(0, 10).map((candidate) => ({ ...candidate, staffName: staffName(state, candidate.staffId) })),
        },
      ]
    }),
  }
}

function requireOpenCoverage(state: DemoServerState, id: string) {
  const item = state.coverage.find((row) => row.id === id) ?? notFound('team:COVERAGE_NOT_FOUND')
  if (item.status !== 'OPEN') conflict('team:COVERAGE_CLOSED')
  return item
}

function confirmCover(ctx: Ctx) {
  const { state } = ctx
  const item = requireOpenCoverage(state, ctx.params.id ?? '')
  const staffId = typeof ctx.body.staffId === 'string' ? ctx.body.staffId : ''
  const staff = state.staff.find((row) => row.id === staffId)
  if (!staff || staff.status !== 'ACTIVE') conflict('team:STAFF_INACTIVE')
  if (state.assignments.some((row) => row.slotId === item.slotId && row.staffId === staffId && row.status === 'ACTIVE')) {
    conflict('team:ALREADY_ASSIGNED')
  }
  fillCoverage(ctx, MANAGEMENT, item.id, staffId)
  return { ok: true }
}

function skipCover(ctx: Ctx) {
  const item = requireOpenCoverage(ctx.state, ctx.params.id ?? '')
  for (const offer of ctx.state.offers.filter((row) => row.coverageId === item.id && row.status === 'PENDING')) {
    offer.status = 'MANAGER_SKIPPED'
    offer.respondedAt = ctx.now.toISOString()
    audit(ctx, MANAGEMENT, { action: 'coverage.skipped_by_manager', entityType: 'coverage', entityId: item.id, after: { staffId: offer.staffId } })
  }
  offerNext(ctx, item.id)
  return { ok: true }
}

function cancelCover(ctx: Ctx) {
  const item = ctx.state.coverage.find((row) => row.id === ctx.params.id && row.status === 'OPEN') ?? conflict('team:COVERAGE_CLOSED')
  item.status = 'CANCELLED'
  item.resolvedAt = ctx.now.toISOString()
  for (const offer of ctx.state.offers.filter((row) => row.coverageId === item.id && row.status === 'PENDING')) {
    offer.status = 'SUPERSEDED'
    offer.respondedAt = ctx.now.toISOString()
  }
  audit(ctx, MANAGEMENT, { action: 'coverage.cancelled', entityType: 'coverage', entityId: item.id })
  return { ok: true }
}

export const rosterRoutes: Route[] = [
  ['GET', '/rms/team/schedule-setup', scheduleSetup],
  ['PUT', '/rms/team/operating-hours', saveHours],
  ['POST', '/rms/team/closed-periods', addClosed],
  ['DELETE', '/rms/team/closed-periods/:id', removeClosed],
  ['PUT', '/rms/team/slot-templates', saveTemplates],
  ['GET', '/rms/team/weeks', listWeeks],
  ['POST', '/rms/team/weeks', createWeek],
  ['GET', '/rms/team/weeks/:id', ({ state, params, now }) => weekDetail(state, params.id ?? '', now)],
  ['PATCH', '/rms/team/weeks/:id', updateWeek],
  ['DELETE', '/rms/team/weeks/:id', deleteWeek],
  ['POST', '/rms/team/weeks/:id/status', setStatus],
  ['POST', '/rms/team/weeks/:id/generate', generate],
  ['POST', '/rms/team/weeks/:id/publish', publish],
  ['POST', '/rms/team/weeks/:id/fill-from-picks', fillFromPicks],
  ['GET', '/rms/team/weeks/:id/export', exportWeek],
  [
    'GET',
    '/rms/team/weeks/:id/export/:format',
    () => demoOnly('The roster picture is drawn by Vista’s server, so it is not in the demo. Print / PDF works here.'),
  ],
  ['POST', '/rms/team/weeks/:id/days/:date/copy-from', copyDay],
  ['POST', '/rms/team/weeks/:id/slots', addSlot],
  ['PATCH', '/rms/team/slots/:id', updateSlot],
  ['DELETE', '/rms/team/slots/:id', removeSlot],
  ['POST', '/rms/team/slots/:id/assignments', assign],
  ['POST', '/rms/team/slots/:id/backups', addBackup],
  ['PATCH', '/rms/team/assignments/:id', updateAssignment],
  ['PATCH', '/rms/team/assignments/:id/time', setBackupTime],
  ['DELETE', '/rms/team/assignments/:id', unassign],
  ['GET', '/rms/team/coverage', listCoverage],
  ['POST', '/rms/team/coverage/:id/confirm', confirmCover],
  ['POST', '/rms/team/coverage/:id/skip', skipCover],
  ['POST', '/rms/team/coverage/:id/offer-next', (ctx) => ({ offerId: offerNext(ctx, ctx.params.id ?? '') })],
  ['POST', '/rms/team/coverage/:id/cancel', cancelCover],
]
